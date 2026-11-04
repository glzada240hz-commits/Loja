/**
 * Via da cozinha: regra do que imprimir (cada envio uma vez; ALTERADO; CANCELADO) e o conteúdo em linhas.
 * Usada pela impressão no navegador (uma impressora) e pelo aplicativo do Windows (impressora escolhida).
 */
import { formatBRL } from './money.js';
import type { PaymentMethod } from './pricing.js';

/** Dados da entrega impressos na via da cozinha (a via vai junto com o motoboy). */
export interface PrintDelivery {
  address: string;
  neighborhood: string | null;
  reference: string | null;
  phone: string | null;
  /** o que o motoboy cobra do cliente */
  collect: string;
}

/** "Rua das Acácias, 120 - apto 2" */
export function deliveryAddressLine(a: { street: string | null; number: string | null; complement: string | null }): string {
  return `${a.street ?? ''}${a.number ? `, ${a.number}` : ''}${a.complement ? ` - ${a.complement}` : ''}`.trim();
}

const PAY_SHORT: Record<PaymentMethod, string> = { cash: 'dinheiro', pix_manual: 'Pix', pix_integrated: 'Pix', credit: 'crédito', debit: 'débito', voucher: 'vale-refeição' };

/** "COBRAR R$ 62,90 — Pix R$ 30,00 + dinheiro R$ 32,90 · troco p/ R$ 50,00 (levar R$ 17,10)" ou "PAGO". */
export function deliveryCollectText(o: {
  totalCents: number;
  paidCents: number;
  paymentIntent: string | null;
  paymentPlan?: { method: string; amountCents: number }[] | null;
  changeForCents: number | null;
}): string {
  const due = o.totalCents - o.paidCents;
  if (due <= 0) return 'PAGO — nada a cobrar';
  const plan = o.paymentPlan?.length ? o.paymentPlan : null;
  const how = plan
    ? plan.map((p) => `${PAY_SHORT[p.method as PaymentMethod] ?? p.method} ${formatBRL(p.amountCents)}`).join(' + ')
    : o.paymentIntent
      ? PAY_SHORT[o.paymentIntent as PaymentMethod] ?? o.paymentIntent
      : '';
  const cashDue = plan ? plan.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amountCents, 0) : o.paymentIntent === 'cash' ? due : 0;
  const change = o.changeForCents && cashDue > 0 && o.changeForCents > cashDue ? ` · troco p/ ${formatBRL(o.changeForCents)} (levar ${formatBRL(o.changeForCents - cashDue)})` : '';
  return `COBRAR ${formatBRL(due)}${how ? ` — ${how}` : ''}${change}`;
}
export interface PrintItem {
  productName: string;
  variantName: string | null;
  quantity: number;
  notes: string | null;
  status: string;
  comboComponents: unknown;
  options: { name: string; group?: string; quantity: number }[];
}
export interface PrintTicket {
  id: string;
  round: number;
  status: string;
  createdAt: string;
  changedAt: string | null;
  changeNote: string | null;
  orderNumber: number;
  /** nº da entrega do dia (marcar na sacola) */
  deliveryNumber?: number | null;
  orderStatus: string;
  place: string;
  createdByName: string | null;
  customerName: string | null;
  orderNotes: string | null;
  delivery?: PrintDelivery | null;
  items: PrintItem[];
}
/** reimpressao: 2ª via pedida pela equipe (comanda perdida) */
export type PrintKind = 'novo' | 'alterado' | 'cancelado' | 'reimpressao';
export type PrintedMap = Record<string, { at: number; changedAt: string | null; cancelled?: boolean }>;

/** O que falta imprimir, na ordem de chegada. Função pura (testada). */
export function pendingPrints(tickets: PrintTicket[], printed: PrintedMap, since: number): { ticket: PrintTicket; kind: PrintKind }[] {
  const out: { ticket: PrintTicket; kind: PrintKind }[] = [];
  for (const t of [...tickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const p = printed[t.id];
    if (t.orderStatus === 'cancelled') {
      if (p && !p.cancelled) out.push({ ticket: t, kind: 'cancelado' });
      continue;
    }
    if (!p) {
      if (Date.parse(t.createdAt) >= since && (t.status === 'received' || t.status === 'preparing')) out.push({ ticket: t, kind: 'novo' });
      continue;
    }
    if (t.changedAt && t.changedAt !== p.changedAt && t.status !== 'ready') out.push({ ticket: t, kind: 'alterado' });
  }
  return out;
}


export type PrintLineStyle = 'title' | 'big' | 'place' | 'center' | 'rule' | 'item' | 'mod' | 'text';
export interface PrintLine {
  style: PrintLineStyle;
  text: string;
}

const hhmmBR = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Conteúdo da via da cozinha em linhas com estilo (sem preços). */
export function ticketLines(t: PrintTicket, kind: PrintKind, printedAt: Date = new Date()): PrintLine[] {
  const head =
    kind === 'cancelado' ? 'CANCELADO — NÃO FAZER' : kind === 'alterado' ? 'ALTERADO' : kind === 'reimpressao' ? '2ª VIA (REIMPRESSÃO)' : t.round > 1 ? `ACRÉSCIMO · RODADA ${t.round}` : 'NOVO PEDIDO';
  const out: PrintLine[] = [
    { style: 'title', text: head },
    ...(t.deliveryNumber
      ? [
          { style: 'big' as const, text: `ENTREGA ${t.deliveryNumber}` },
          { style: 'center' as const, text: `escreva ${t.deliveryNumber} na sacola · pedido #${t.orderNumber}` },
        ]
      : [{ style: 'big' as const, text: `#${t.orderNumber}` }, { style: 'place' as const, text: t.place.toUpperCase() }]),
    { style: 'center', text: `${hhmmBR(t.createdAt)}${t.createdByName ? ` · ${t.createdByName}` : ''}` },
  ];
  if (t.customerName) out.push({ style: 'center', text: t.customerName });
  out.push({ style: 'rule', text: '' });
  for (const i of t.items.filter((x) => x.status === 'active' || kind === 'cancelado')) {
    out.push({ style: 'item', text: `${i.quantity}x ${i.productName}${i.variantName ? ` (${i.variantName})` : ''}` });
    if (Array.isArray(i.comboComponents) && i.comboComponents.length)
      out.push({ style: 'mod', text: (i.comboComponents as { quantity: number; label: string }[]).map((c) => `${c.quantity}x ${c.label}`).join(' + ') });
    for (const o of i.options) out.push({ style: 'mod', text: /^sem /i.test(o.name) ? o.name.toUpperCase() : `+ ${o.quantity > 1 ? `${o.quantity}x ` : ''}${o.name}` });
    if (i.notes) out.push({ style: 'mod', text: `OBS: ${i.notes}` });
  }
  if (kind === 'alterado' && t.changeNote) out.push({ style: 'rule', text: '' }, { style: 'text', text: `ALTERAÇÃO: ${t.changeNote}` });
  if (t.orderNotes) out.push({ style: 'rule', text: '' }, { style: 'text', text: `OBS DO PEDIDO: ${t.orderNotes}` });
  if (t.delivery && kind !== 'cancelado') {
    const d = t.delivery;
    out.push({ style: 'rule', text: '' }, { style: 'title', text: 'ENTREGA' });
    if (d.neighborhood) out.push({ style: 'place', text: d.neighborhood.toUpperCase() });
    if (d.address) out.push({ style: 'item', text: d.address });
    if (d.reference) out.push({ style: 'text', text: `Ref.: ${d.reference}` });
    out.push({ style: 'text', text: [t.customerName, d.phone].filter(Boolean).join(' · ') });
    out.push({ style: 'item', text: d.collect });
  }
  out.push({ style: 'rule', text: '' }, { style: 'center', text: `impresso ${hhmmBR(printedAt.toISOString())}` });
  return out;
}

/** Folha de teste da impressora da cozinha. */
export const testTicket = (): PrintTicket => ({
  id: 'teste', round: 1, status: 'received', createdAt: new Date().toISOString(), changedAt: null, changeNote: null,
  orderNumber: 0, orderStatus: 'open', place: 'Teste de impressão', createdByName: null, customerName: null,
  orderNotes: 'Se esta folha saiu, a impressão da cozinha está funcionando.',
  items: [{ productName: 'X-Burguer', variantName: null, quantity: 1, notes: 'sem cebola', status: 'active', comboComponents: null, options: [{ name: 'Bacon', quantity: 1 }] }],
});
