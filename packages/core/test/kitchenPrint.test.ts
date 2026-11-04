import { describe, expect, it } from 'vitest';
import { testTicket, ticketLines } from '../src/kitchenPrint';

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
