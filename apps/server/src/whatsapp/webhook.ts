import { and, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { ORDER_STAGE_LABEL, normalizePhoneBR, phoneVariantsBR } from '@guto/core';
import type { Db, Tx } from '../db/index.js';
import { orders, waContacts, waMessages, waWebhookEvents } from '../db/schema.js';
import { now } from '../lib/clock.js';
import type { Deps } from '../lib/context.js';
import { hmacSha256Hex, safeEqualHex } from '../lib/crypto.js';
import type { LiveEvent } from '../lib/events.js';
import { getSettings } from '../services/settings.js';
import { contactForPhone, linkContactToCustomer, menuUrl, trackingUrl, windowOpen } from './notify.js';

/** Valida X-Hub-Signature-256 (HMAC-SHA256 do corpo BRUTO com o App Secret). */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = hmacSha256Hex(appSecret, rawBody);
  return safeEqualHex(header.slice(7), expected);
}

interface InboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  button?: { text: string };
  image?: { caption?: string; id: string };
  document?: { caption?: string; filename?: string; id: string };
}
interface StatusUpdate {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: { code: number; title: string; message?: string }[];
}
interface WebhookPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: InboundMessage[];
        statuses?: StatusUpdate[];
      };
    }[];
  }[];
}

/**
 * Registra os eventos do webhook (deduplicados) e tenta processá-los na hora.
 * Retorna rapidamente; falhas de processamento ficam para nova tentativa pelo worker.
 */
export async function ingestWebhook(deps: Deps, payload: WebhookPayload) {
  if (payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return { stored: 0, duplicates: 0 };
  let stored = 0;
  let duplicates = 0;
  const ids: string[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages' || !change.value) continue;
      const v = change.value;
      for (const m of v.messages ?? []) {
        if (!m?.id || !m.from) continue;
        const profileName = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        const r = await deps.db
          .insert(waWebhookEvents)
          .values({ dedupeKey: 'msg:' + m.id, kind: 'message', payload: { message: m, profileName }, receivedAt: now() })
          .onConflictDoNothing()
          .returning({ id: waWebhookEvents.id });
        if (r[0]) {
          stored++;
          ids.push(r[0].id);
        } else duplicates++;
      }
      for (const s of v.statuses ?? []) {
        if (!s?.id || !s.status) continue;
        const r = await deps.db
          .insert(waWebhookEvents)
          .values({ dedupeKey: `st:${s.id}:${s.status}`, kind: 'status', payload: { status: s }, receivedAt: now() })
          .onConflictDoNothing()
          .returning({ id: waWebhookEvents.id });
        if (r[0]) {
          stored++;
          ids.push(r[0].id);
        } else duplicates++;
      }
    }
  }
  for (const id of ids) await processEvent(deps, id);
  return { stored, duplicates };
}

const RETRY_DELAYS_S = [10, 60, 300, 1800, 7200];

export async function processEvent(deps: Deps, eventId: string) {
  const emitted: LiveEvent[] = [];
  try {
    await deps.db.transaction(async (tx) => {
      const [ev] = await tx.select().from(waWebhookEvents).where(eq(waWebhookEvents.id, eventId)).for('update', { skipLocked: true });
      if (!ev || ev.status === 'processed') return;
      if (ev.kind === 'message') {
        const p = ev.payload as { message: InboundMessage; profileName: string | null };
        await handleInbound(tx, p.message, p.profileName, (e) => emitted.push(e));
      } else {
        await handleStatus(tx, (ev.payload as { status: StatusUpdate }).status, (e) => emitted.push(e));
      }
      await tx.update(waWebhookEvents).set({ status: 'processed', processedAt: now(), error: null }).where(eq(waWebhookEvents.id, eventId));
    });
    for (const e of emitted) deps.bus.publish(e);
  } catch (err) {
    const [ev] = await deps.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.id, eventId));
    const attempts = (ev?.attempts ?? 0) + 1;
    const delay = RETRY_DELAYS_S[Math.min(attempts - 1, RETRY_DELAYS_S.length - 1)]!;
    await deps.db
      .update(waWebhookEvents)
      .set({
        status: attempts >= 8 ? 'failed' : 'pending',
        attempts,
        error: (err as Error).message.slice(0, 500),
        nextAttemptAt: new Date(now().getTime() + delay * 1000),
      })
      .where(eq(waWebhookEvents.id, eventId));
  }
}

/** Reprocessa eventos pendentes cujo horário de nova tentativa chegou. */
export async function retryPendingEvents(deps: Deps) {
  const due = await deps.db
    .select({ id: waWebhookEvents.id })
    .from(waWebhookEvents)
    .where(and(eq(waWebhookEvents.status, 'pending'), or(lte(waWebhookEvents.nextAttemptAt, now()), sql`${waWebhookEvents.nextAttemptAt} is null`)))
    .limit(50);
  for (const e of due) await processEvent(deps, e.id);
  return due.length;
}

function messageText(m: InboundMessage): { type: string; body: string } {
  switch (m.type) {
    case 'text':
      return { type: 'text', body: m.text?.body ?? '' };
    case 'interactive':
      return { type: 'interactive', body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '' };
    case 'button':
      return { type: 'button', body: m.button?.text ?? '' };
    case 'image':
      return { type: 'image', body: '[Imagem recebida]' + (m.image?.caption ? ' ' + m.image.caption : '') };
    case 'document':
      return { type: 'document', body: '[Documento recebido] ' + (m.document?.filename ?? '') + (m.document?.caption ? ' ' + m.document.caption : '') };
    default:
      return { type: m.type || 'unknown', body: `[Mensagem do tipo "${m.type}" recebida]` };
  }
}

const OPT_OUT = /^\s*(parar|sair|stop|cancelar mensagens|descadastrar)\s*$/i;
const OPT_IN = /^\s*(voltar|receber|aceito)\s*$/i;

async function handleInbound(tx: Tx, m: InboundMessage, profileName: string | null, emit: (e: LiveEvent) => void) {
  const waId = normalizePhoneBR(m.from) ?? m.from.replace(/\D/g, '');
  const contact = await contactForPhone(tx, waId);
  const sentAt = new Date(Number(m.timestamp) * 1000 || now().getTime());
  const { type, body } = messageText(m);
  const inserted = await tx
    .insert(waMessages)
    .values({ contactId: contact.id, direction: 'in', wamid: m.id, type, body: body.slice(0, 4096), status: 'received', statusAt: sentAt, createdAt: sentAt })
    .onConflictDoNothing()
    .returning({ id: waMessages.id });
  if (!inserted.length) return; // mensagem repetida
  // eventos fora de ordem: a janela usa a mensagem mais recente, nunca retrocede
  await tx
    .update(waContacts)
    .set({
      profileName: profileName ?? contact.profileName,
      lastInboundAt: sql`greatest(coalesce(${waContacts.lastInboundAt}, 'epoch'::timestamptz), ${sentAt.toISOString()}::timestamptz)`,
      lastMessageAt: sql`greatest(coalesce(${waContacts.lastMessageAt}, 'epoch'::timestamptz), ${sentAt.toISOString()}::timestamptz)`,
      unreadCount: sql`${waContacts.unreadCount} + 1`,
    })
    .where(eq(waContacts.id, contact.id));
  if (!contact.customerId) await linkContactToCustomer(tx, contact.id, waId);
  emit({ type: 'whatsapp.changed', contactId: contact.id });

  if (OPT_OUT.test(body)) {
    await tx.update(waContacts).set({ optOutAt: now(), optInOrderUpdates: false, optInMarketing: false }).where(eq(waContacts.id, contact.id));
    await queueReply(tx, contact.id, 'Pronto, você não receberá mais mensagens automáticas. Para voltar, responda VOLTAR.', emit, true);
    return;
  }
  if (OPT_IN.test(body) && contact.optOutAt) {
    await tx.update(waContacts).set({ optOutAt: null, optInOrderUpdates: true, optInAt: now(), optInSource: 'whatsapp' }).where(eq(waContacts.id, contact.id));
    await queueReply(tx, contact.id, 'Combinado! Você voltará a receber as atualizações dos seus pedidos.', emit, true);
    return;
  }
  await botReply(tx, contact.id, body, emit);
}

/**
 * Atendimento automático por regras fixas (sem IA): oferece o cardápio digital,
 * informa o status dos pedidos DESTE telefone e encaminha para um atendente.
 * O texto do cliente é tratado apenas como conteúdo — nunca como comando privilegiado.
 */
async function botReply(tx: Tx, contactId: string, body: string, emit: (e: LiveEvent) => void) {
  const settings = await getSettings(tx);
  const [c] = await tx.select().from(waContacts).where(eq(waContacts.id, contactId));
  if (!c || !settings.waAutoReplyEnabled || c.botPaused || c.needsHuman || c.optOutAt) return;
  const t = body.trim().toLowerCase();
  if (/^(3|atendente|humano|pessoa|falar com atendente)$/.test(t)) {
    await tx.update(waContacts).set({ needsHuman: true, botPaused: true }).where(eq(waContacts.id, contactId));
    await queueReply(tx, contactId, 'Certo! Um atendente vai continuar a conversa em instantes.', emit);
    return;
  }
  if (/^(1|card[aá]pio|menu|pedido|pedir|fazer pedido)$/.test(t)) {
    await queueReply(tx, contactId, `Veja o cardápio com preços atualizados e faça seu pedido por aqui: ${menuUrl()}`, emit);
    return;
  }
  if (/^(2|status|meu pedido|cad[eê] meu pedido)$/.test(t)) {
    const list = await tx
      .select()
      .from(orders)
      .where(and(inArray(orders.customerPhone, phoneVariantsBR(c.waId)), inArray(orders.status, ['pending', 'open'])))
      .orderBy(desc(orders.createdAt))
      .limit(3);
    if (!list.length) {
      await queueReply(tx, contactId, 'Não encontrei pedidos em andamento para este número. Responda 3 para falar com um atendente.', emit);
      return;
    }
    const lines = list.map((o) => {
      const st = o.status === 'pending' ? 'aguardando confirmação da loja' : ORDER_STAGE_LABEL[o.stage].toLowerCase();
      return `Pedido #${o.number}: ${st}. ${o.trackingToken ? trackingUrl(o.trackingToken) : ''}`;
    });
    await queueReply(tx, contactId, lines.join('\n'), emit);
    return;
  }
  // saudação, no máximo uma vez a cada 30 minutos
  const [lastBot] = await tx
    .select({ at: waMessages.createdAt })
    .from(waMessages)
    .where(and(eq(waMessages.contactId, contactId), eq(waMessages.direction, 'out'), eq(waMessages.automated, true)))
    .orderBy(desc(waMessages.createdAt))
    .limit(1);
  if (lastBot && now().getTime() - lastBot.at.getTime() < 30 * 60000) return;
  await queueReply(tx, contactId, settings.waGreeting, emit);
}

async function queueReply(tx: Tx, contactId: string, text: string, emit: (e: LiveEvent) => void, ignoreOptOut = false) {
  const [c] = await tx.select().from(waContacts).where(eq(waContacts.id, contactId));
  if (!c || (c.optOutAt && !ignoreOptOut) || !windowOpen(c.lastInboundAt)) return;
  await tx.insert(waMessages).values({ contactId, direction: 'out', type: 'text', body: text, status: 'queued', nextAttemptAt: now(), automated: true, createdAt: now() });
  emit({ type: 'wa.outbox' });
}

const STATUS_RANK: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5, received: -1 };

async function handleStatus(tx: Tx, s: StatusUpdate, emit: (e: LiveEvent) => void) {
  const [msg] = await tx.select().from(waMessages).where(eq(waMessages.wamid, s.id)).for('update');
  // status pode chegar antes de gravarmos o wamid do envio: erro => nova tentativa mais tarde
  if (!msg) throw new Error('Mensagem ainda não encontrada para o status ' + s.status);
  const current = STATUS_RANK[msg.status] ?? 0;
  const incoming = STATUS_RANK[s.status] ?? 0;
  const at = new Date(Number(s.timestamp) * 1000 || now().getTime());
  if (s.status === 'failed') {
    if (msg.status === 'delivered' || msg.status === 'read') return;
    const e = s.errors?.[0];
    await tx.update(waMessages).set({ status: 'failed', statusAt: at, error: e ? `${e.code} ${e.title}${e.message ? ': ' + e.message : ''}` : 'Falha informada pela plataforma' }).where(eq(waMessages.id, msg.id));
  } else if (incoming > current && msg.status !== 'failed') {
    await tx.update(waMessages).set({ status: s.status, statusAt: at }).where(eq(waMessages.id, msg.id));
  } else return; // fora de ordem (ex.: "sent" depois de "read") — ignora
  emit({ type: 'whatsapp.changed', contactId: msg.contactId });
}

/** Utilitário para testes/demonstração: gera o payload no formato da Cloud API. */
export function buildInboundPayload(from: string, text: string, id: string, profileName = 'Cliente', timestamp = Math.floor(now().getTime() / 1000)): WebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              contacts: [{ wa_id: from, profile: { name: profileName } }],
              messages: [{ from, id, timestamp: String(timestamp), type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

export function buildStatusPayload(wamid: string, status: StatusUpdate['status'], recipient: string, timestamp = Math.floor(now().getTime() / 1000)): WebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: wamid, status, recipient_id: recipient, timestamp: String(timestamp) }] } }] }],
  };
}

export type { Db };
