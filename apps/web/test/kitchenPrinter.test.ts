import { describe, expect, it } from 'vitest';
import { pendingPrints, ticketHtml, type PrintTicket } from '../src/lib/kitchenPrinter';

const T = (p: Partial<PrintTicket>): PrintTicket => ({
  id: 't1', round: 1, status: 'received', createdAt: '2026-11-03T20:00:00.000Z', changedAt: null, changeNote: null,
  orderNumber: 7, orderStatus: 'open', place: 'Mesa 4', createdByName: 'Ana', customerName: null, orderNotes: null,
  items: [{ productName: 'X-Bacon', variantName: null, quantity: 2, notes: 'bem passado', status: 'active', comboComponents: null, options: [{ name: 'sem cebola', quantity: 1 }, { name: 'Cheddar', quantity: 2 }] }],
  ...p,
});
const since = Date.parse('2026-11-03T19:00:00.000Z');

describe('impressão automática da cozinha', () => {
  it('imprime cada envio uma vez, na ordem de chegada, e ignora o que já existia antes de ligar', () => {
    const a = T({ id: 'a', createdAt: '2026-11-03T20:05:00.000Z' });
    const b = T({ id: 'b', createdAt: '2026-11-03T20:01:00.000Z', round: 2 });
    const old = T({ id: 'old', createdAt: '2026-11-03T18:00:00.000Z' });
    expect(pendingPrints([a, b, old], {}, since).map((x) => [x.ticket.id, x.kind])).toEqual([['b', 'novo'], ['a', 'novo']]);
    expect(pendingPrints([a, b], { a: { at: 1, changedAt: null }, b: { at: 1, changedAt: null } }, since)).toEqual([]);
  });

  it('pronto não imprime; alteração reimprime; cancelamento só avisa se já tinha impresso', () => {
    expect(pendingPrints([T({ status: 'ready' })], {}, since)).toEqual([]);
    const changed = T({ changedAt: '2026-11-03T20:10:00.000Z', changeNote: '1x X-Bacon cancelado' });
    expect(pendingPrints([changed], { t1: { at: 1, changedAt: null } }, since)[0]!.kind).toBe('alterado');
    expect(pendingPrints([changed], { t1: { at: 1, changedAt: changed.changedAt } }, since)).toEqual([]);
    const cancelled = T({ orderStatus: 'cancelled' });
    expect(pendingPrints([cancelled], {}, since)).toEqual([]);
    expect(pendingPrints([cancelled], { t1: { at: 1, changedAt: null } }, since)[0]!.kind).toBe('cancelado');
    expect(pendingPrints([cancelled], { t1: { at: 1, changedAt: null, cancelled: true } }, since)).toEqual([]);
  });

  it('via da cozinha: número, local, itens, adicionais, observação e cabeçalho do tipo; escapa HTML', () => {
    const html = ticketHtml(T({ round: 2, orderNotes: '<script>x</script>' }), 'novo', 58);
    expect(html).toContain('ACRÉSCIMO · RODADA 2');
    expect(html).toContain('#7');
    expect(html).toContain('MESA 4');
    expect(html).toContain('2x X-Bacon');
    expect(html).toContain('SEM CEBOLA');
    expect(html).toContain('+ 2x Cheddar');
    expect(html).toContain('OBS: bem passado');
    expect(html).toContain('size: 58mm auto');
    expect(html).not.toContain('<script>x');
    expect(ticketHtml(T({}), 'cancelado')).toContain('CANCELADO — NÃO FAZER');
    expect(ticketHtml(T({}), 'novo')).not.toMatch(/R\$/);
  });
});
