import { describe, expect, it } from 'vitest';
import { deliveryAddressLine, deliveryCollectText, testTicket, ticketLines } from '../src/kitchenPrint';

describe('via da cozinha', () => {
  it('delivery mostra o nº da entrega em destaque para escrever na sacola', () => {
    const lines = ticketLines({ ...testTicket(), orderNumber: 12, deliveryNumber: 3, place: 'Delivery' }, 'novo');
    expect(lines.find((l) => l.style === 'big')!.text).toBe('ENTREGA 3');
    expect(lines.some((l) => l.text === 'escreva 3 na sacola · pedido #12')).toBe(true);
  });
  it('sem nº de entrega continua com o nº do pedido', () => {
    const lines = ticketLines({ ...testTicket(), orderNumber: 7, place: 'Mesa 2' }, 'novo');
    expect(lines.find((l) => l.style === 'big')!.text).toBe('#7');
    expect(lines.some((l) => l.text === 'MESA 2')).toBe(true);
  });
});

describe('via da cozinha: entrega para o motoboy e 2ª via', () => {
  const base = { ...testTicket(), orderNumber: 9, deliveryNumber: 2, place: 'Delivery', customerName: 'Carla Souza' };
  it('traz bairro, endereço, referência, telefone e o que cobrar', () => {
    const t = { ...base, delivery: { address: 'Av. Brasil, 450 - apto 2', neighborhood: 'Santa Martinha', reference: 'perto da padaria', phone: '(31) 98877-1020', collect: deliveryCollectText({ totalCents: 6290, paidCents: 3000, paymentIntent: 'cash', paymentPlan: [{ method: 'pix_manual', amountCents: 3000 }, { method: 'cash', amountCents: 3290 }], changeForCents: 5000 }) } };
    const txt = ticketLines(t, 'novo').map((l) => l.text);
    expect(txt).toContain('SANTA MARTINHA');
    expect(txt).toContain('Av. Brasil, 450 - apto 2');
    expect(txt).toContain('Ref.: perto da padaria');
    expect(txt).toContain('Carla Souza · (31) 98877-1020');
    expect(txt).toContain('COBRAR R$ 32,90 — Pix R$ 30,00 + dinheiro R$ 32,90 · troco p/ R$ 50,00 (levar R$ 17,10)');
  });
  it('pago não cobra; cancelado não imprime endereço', () => {
    expect(deliveryCollectText({ totalCents: 2000, paidCents: 2000, paymentIntent: 'pix_manual', paymentPlan: null, changeForCents: null })).toBe('PAGO — nada a cobrar');
    const t = { ...base, delivery: { address: 'Rua A, 1', neighborhood: 'Centro', reference: null, phone: null, collect: 'x' } };
    expect(ticketLines(t, 'cancelado').some((l) => l.text === 'Rua A, 1')).toBe(false);
  });
  it('2ª via tem cabeçalho próprio', () => {
    expect(ticketLines(base, 'reimpressao')[0]).toEqual({ style: 'title', text: '2ª VIA (REIMPRESSÃO)' });
  });
  it('linha do endereço', () => {
    expect(deliveryAddressLine({ street: 'Rua X', number: '10', complement: null })).toBe('Rua X, 10');
  });
});
