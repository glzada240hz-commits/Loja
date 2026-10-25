import { eq, inArray } from 'drizzle-orm';
import { formatBRL, formatTime, phoneVariantsBR } from '@guto/core';
import type { DbOrTx, Tx } from '../db/index.js';
import { customers, orders, waContacts, waMessages, waTemplates } from '../db/schema.js';
import { now } from '../lib/clock.js';
import type { LiveEvent } from '../lib/events.js';
import { getSettings } from '../services/settings.js';

export const CUSTOMER_WINDOW_MS = 24 * 3600 * 1000;

let publicBaseUrl = 'http://localhost:3000';
export function configureNotify(opts: { publicBaseUrl: string }) {
  publicBaseUrl = opts.publicBaseUrl.replace(/\/$/, '');
}
export function trackingUrl(token: string) {
  return `${publicBaseUrl}/c/pedido/${token}`;
}
export function menuUrl() {
  return `${publicBaseUrl}/c`;
}

export type NotificationPurpose = 'order_received' | 'order_accepted' | 'order_ready' | 'order_dispatched' | 'order_cancelled';

export function windowOpen(lastInboundAt: Date | null | undefined, at = now()) {
  return !!lastInboundAt && at.getTime() - lastInboundAt.getTime() < CUSTOMER_WINDOW_MS;
}

/** Busca ou cria o contato do WhatsApp para um telefone (com/sem nono dígito). */
export async function contactForPhone(tx: DbOrTx, phone: string, customerId?: string | null) {
  const variants = phoneVariantsBR(phone);
  const [existing] = await tx.select().from(waContacts).where(inArray(waContacts.waId, variants));
  if (existing) {
    if (customerId && !existing.customerId) await tx.update(waContacts).set({ customerId }).where(eq(waContacts.id, existing.id));
    return existing;
  }
  const [c] = await tx
    .insert(waContacts)
    .values({ waId: phone, customerId: customerId ?? null, createdAt: now() })
    .onConflictDoNothing()
    .returning();
  if (c) return c;
  const [again] = await tx.select().from(waContacts).where(eq(waContacts.waId, phone));
  return again!;
}

function textFor(purpose: NotificationPurpose, o: typeof orders.$inferSelect, store: string): { text: string; params: string[] } {
  const n = `#${o.number}`;
  const link = o.trackingToken ? trackingUrl(o.trackingToken) : '';
  switch (purpose) {
    case 'order_received':
      return {
        text: `${store}: recebemos seu pedido ${n} (total ${formatBRL(o.totalCents)}). Ele ainda será CONFIRMADO pela loja. Acompanhe: ${link}`,
        params: [n, formatBRL(o.totalCents), link],
      };
    case 'order_accepted':
      return {
        text: `${store}: seu pedido ${n} foi confirmado pela loja.${o.etaAt ? ' Previsão: ' + formatTime(o.etaAt) + '.' : ''} Acompanhe: ${link}`,
        params: [n, o.etaAt ? formatTime(o.etaAt) : '-', link],
      };
    case 'order_ready':
      return { text: `${store}: seu pedido ${n} está pronto para retirada.`, params: [n] };
    case 'order_dispatched':
      return { text: `${store}: seu pedido ${n} saiu para entrega. Acompanhe: ${link}`, params: [n, link] };
    case 'order_cancelled':
      return { text: `${store}: seu pedido ${n} foi cancelado. Se tiver dúvidas, responda esta mensagem.`, params: [n] };
  }
}

/**
 * Enfileira uma atualização de pedido. Chamado DENTRO da transação que confirmou o evento:
 * se a transação falhar, a mensagem nunca existe. A chave de deduplicação impede envio repetido.
 * Só envia se o cliente aceitou receber atualizações (opt-in) e não pediu para sair.
 * Fora da janela de 24h usa template aprovado; sem template configurado, registra a falha.
 */
export async function enqueueOrderNotification(tx: Tx, orderId: string, purpose: NotificationPurpose, emit: (e: LiveEvent) => void) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!o || !o.waOptIn || !o.customerPhone) return;
  const contact = await contactForPhone(tx, o.customerPhone, o.customerId);
  if (contact.optOutAt) return;
  if (!contact.optInOrderUpdates) {
    await tx
      .update(waContacts)
      .set({ optInOrderUpdates: true, optInAt: contact.optInAt ?? o.createdAt, optInSource: contact.optInSource ?? (o.source === 'online' ? 'cardapio_digital' : 'atendimento') })
      .where(eq(waContacts.id, contact.id));
  }
  const store = (await getSettings(tx)).storeName;
  const { text, params } = textFor(purpose, o, store);
  const inWindow = windowOpen(contact.lastInboundAt);
  let values: typeof waMessages.$inferInsert;
  const base = { contactId: contact.id, direction: 'out' as const, orderId: o.id, automated: true, dedupeKey: `order:${o.id}:${purpose}`, createdAt: now() };
  if (inWindow) {
    values = { ...base, type: 'text', body: text, status: 'queued', nextAttemptAt: now() };
  } else {
    const [tpl] = await tx.select().from(waTemplates).where(eq(waTemplates.purpose, purpose));
    if (tpl?.active) {
      values = { ...base, type: 'template', body: text, templateName: tpl.name, templateParams: { language: tpl.language, params }, status: 'queued', nextAttemptAt: now() };
    } else {
      values = {
        ...base,
        type: 'template',
        body: text,
        templateParams: { language: 'pt_BR', params },
        status: 'failed',
        error: 'Fora da janela de 24h e sem template aprovado configurado para "' + purpose + '"',
      };
    }
  }
  const ins = await tx.insert(waMessages).values(values).onConflictDoNothing().returning({ id: waMessages.id });
  if (ins.length) {
    await tx.update(waContacts).set({ lastMessageAt: now() }).where(eq(waContacts.id, contact.id));
    emit({ type: 'wa.outbox' });
    emit({ type: 'whatsapp.changed', contactId: contact.id });
  }
}

export async function linkContactToCustomer(tx: DbOrTx, contactId: string, phone: string) {
  const variants = phoneVariantsBR(phone);
  const [c] = await tx.select().from(customers).where(inArray(customers.phone, variants));
  if (c) await tx.update(waContacts).set({ customerId: c.id }).where(eq(waContacts.id, contactId));
  return c ?? null;
}
