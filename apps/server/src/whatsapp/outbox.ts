import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { waContacts, waMessages } from '../db/schema.js';
import { now } from '../lib/clock.js';
import type { Deps } from '../lib/context.js';
import { windowOpen } from './notify.js';
import { ProviderError, type WaProvider } from './provider.js';

export const MAX_ATTEMPTS = 5;
const BACKOFF_S = [15, 60, 300, 1200, 3600];

/**
 * Envia mensagens da fila. Cada mensagem é "reservada" (status sending) numa transação curta com
 * SKIP LOCKED, então dois workers nunca enviam a mesma mensagem. Falhas temporárias voltam para a
 * fila com espera crescente; após MAX_ATTEMPTS a mensagem fica como falha para ação humana.
 */
export async function processOutbox(deps: Deps, provider: WaProvider, limit = 20) {
  const claimed = await deps.db.transaction(async (tx) => {
    const due = await tx
      .select({ id: waMessages.id })
      .from(waMessages)
      .where(and(eq(waMessages.status, 'queued'), eq(waMessages.direction, 'out'), lte(waMessages.nextAttemptAt, now())))
      .orderBy(asc(waMessages.createdAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (!due.length) return [];
    return tx
      .update(waMessages)
      .set({ status: 'sending', attempts: sql`${waMessages.attempts} + 1`, statusAt: now() })
      .where(inArray(waMessages.id, due.map((d) => d.id)))
      .returning();
  });
  let sent = 0;
  for (const m of claimed) {
    const [c] = await deps.db.select().from(waContacts).where(eq(waContacts.id, m.contactId));
    try {
      if (!c) throw new ProviderError('Contato removido', false);
      if (m.type === 'text' && !windowOpen(c.lastInboundAt)) {
        throw new ProviderError('Janela de atendimento de 24h encerrada: use um template aprovado', false, 'window_closed');
      }
      if (c.optOutAt && m.automated && m.orderId) throw new ProviderError('Cliente pediu para não receber mensagens automáticas', false, 'opt_out');
      const res =
        m.type === 'template'
          ? await provider.sendTemplate(c.waId, {
              name: m.templateName!,
              language: (m.templateParams as { language: string }).language,
              bodyParams: (m.templateParams as { params: string[] }).params,
            })
          : await provider.sendText(c.waId, m.body ?? '');
      await deps.db.update(waMessages).set({ status: 'sent', wamid: res.wamid, statusAt: now(), error: null, nextAttemptAt: null }).where(eq(waMessages.id, m.id));
      sent++;
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError((e as Error).message, true);
      const final = !pe.retryable || m.attempts >= MAX_ATTEMPTS;
      await deps.db
        .update(waMessages)
        .set({
          status: final ? 'failed' : 'queued',
          error: pe.message.slice(0, 500),
          nextAttemptAt: final ? null : new Date(now().getTime() + BACKOFF_S[Math.min(m.attempts - 1, BACKOFF_S.length - 1)]! * 1000),
          statusAt: now(),
        })
        .where(eq(waMessages.id, m.id));
    }
    deps.bus.publish({ type: 'whatsapp.changed', contactId: m.contactId });
  }
  return { claimed: claimed.length, sent };
}

/**
 * Mensagens presas em "sending" (servidor reiniciou durante o envio) podem ter sido entregues.
 * Para não duplicar, são marcadas como falha e ficam disponíveis para reenvio manual.
 */
export async function recoverStuck(deps: Deps, olderThanMs = 5 * 60000) {
  const r = await deps.db
    .update(waMessages)
    .set({ status: 'failed', error: 'Envio interrompido (reinício do servidor). Confira com o cliente antes de reenviar.' })
    .where(and(eq(waMessages.status, 'sending'), lte(waMessages.statusAt, new Date(now().getTime() - olderThanMs))))
    .returning({ id: waMessages.id });
  return r.length;
}
