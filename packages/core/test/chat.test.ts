import { describe, expect, it } from 'vitest';
import { parseChatText } from '../src/chat';

const neighborhoods = ['Santa Martinha', 'Centro', 'Vila', 'São Judas'].map((name, i) => ({ id: `n${i}`, name }));
const products = [
  { id: 'p1', name: 'X-Tudo', variants: [{ id: 'v1', name: 'Único' }] },
  { id: 'p2', name: 'Fritas', variants: [{ id: 'v2', name: 'Único' }] },
  { id: 'p3', name: 'Fritas c/ Cheddar e Bacon', variants: [{ id: 'v3', name: 'Único' }] },
  { id: 'p4', name: 'Coca-Cola 2L', variants: [{ id: 'v4', name: 'Único' }] },
  { id: 'p5', name: 'Heineken', variants: [{ id: 'v5', name: '600ml' }, { id: 'v6', name: 'Long neck' }] },
];
const opts = { neighborhoods, products };

describe('print da conversa', () => {
  it('lê endereço, bairro, itens, valores e o nome do contato', () => {
    const text = `Juliana Prado
online
Boa noite! Quero 2 x-tudo e uma fritas c/ cheddar e bacon 19:40 ✓✓
e 1 coca-cola 2L 19:40
Rua das Acácias, 120
apto 2
Santa Martinha 19:41
Total R$ 74,90 19:43
Vou pagar em dinheiro, troco pra R$ 100,00`;
    const r = parseChatText(text, opts);
    expect(r.name).toBe('Juliana Prado');
    expect(r.address).toMatchObject({ street: 'Rua das Acácias', number: '120', complement: 'apto 2', neighborhoodId: 'n0' });
    expect(r.items).toEqual([
      { productId: 'p1', variantId: 'v1', name: 'X-Tudo', quantity: 2 },
      { productId: 'p3', variantId: 'v3', name: 'Fritas c/ Cheddar e Bacon', quantity: 1 },
      { productId: 'p4', variantId: 'v4', name: 'Coca-Cola 2L', quantity: 1 },
    ]);
    expect(r.amounts).toEqual([7490, 10000]);
    expect(r.phone).toBeNull();
  });
  it('contato não salvo: telefone do topo; variante pelo nome', () => {
    const r = parseChatText('+55 31 98877-1020\n3 heineken long neck\nAv. Brasil 450 - Centro', opts);
    expect(r.phone).toBe('5531988771020');
    expect(r.items).toEqual([{ productId: 'p5', variantId: 'v6', name: 'Heineken Long neck', quantity: 3 }]);
    expect(r.address).toMatchObject({ street: 'Av. Brasil', number: '450', neighborhoodId: 'n1' });
  });
});
