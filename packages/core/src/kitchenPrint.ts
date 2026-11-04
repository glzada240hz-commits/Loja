/**
 * Via da cozinha: regra do que imprimir (cada envio uma vez; ALTERADO; CANCELADO) e o conteúdo em linhas.
 * Usada pela impressão no navegador (uma impressora) e pelo aplicativo do Windows (impressora escolhida).
 */
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
  items: PrintItem[];
}
export type PrintKind = 'novo' | 'alterado' | 'cancelado';
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
  const head = kind === 'cancelado' ? 'CANCELADO — NÃO FAZER' : kind === 'alterado' ? 'ALTERADO' : t.round > 1 ? `ACRÉSCIMO · RODADA ${t.round}` : 'NOVO PEDIDO';
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
