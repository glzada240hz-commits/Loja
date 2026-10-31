import { describe, expect, it } from 'vitest';
import { lineFromItem } from '../src/lib/repeat';
import type { MenuProduct } from '../src/lib/types';

const product = (over: Partial<MenuProduct> = {}): MenuProduct => ({
  id: 'p1', categoryId: 'c1', code: '3', name: 'X-Bacon', description: null, imagePath: null, kind: 'simple', available: true, showOnline: true, sort: 0,
  variants: [{ id: 'v1', name: 'Único', priceCents: 1990, costCents: null, available: true }],
  groups: [{ id: 'g1', name: 'Adicionais', minSelect: 0, maxSelect: 5, options: [{ id: 'o1', name: 'Cheddar', priceCents: 400, costCents: null, available: true }] }],
  combo: [],
  ...over,
});
const item = { productName: 'X-Bacon', variantName: null, options: [{ id: 'x', groupName: 'Adicionais', optionName: 'Cheddar', priceCents: 300, quantity: 1 }], notes: 'bem passado' };

describe('repetir item/pedido', () => {
  it('usa o preço ATUAL do cardápio (não o do pedido antigo) e mantém adicionais e observação', () => {
    const l = lineFromItem(item, [product()], 2)!;
    expect(l.unitPriceCents).toBe(1990);
    expect(l.options).toEqual([{ optionId: 'o1', name: 'Cheddar', priceCents: 400, quantity: 1 }]);
    expect(l.notes).toBe('bem passado');
    expect(l.quantity).toBe(2);
    expect(l.variantName).toBeNull();
  });
  it('recusa produto, tamanho ou adicional que não existe mais ou está indisponível', () => {
    expect(lineFromItem(item, [])).toBeNull();
    expect(lineFromItem(item, [product({ available: false })])).toBeNull();
    expect(lineFromItem(item, [product({ variants: [{ id: 'v1', name: 'Único', priceCents: 1990, costCents: null, available: false }] })])).toBeNull();
    expect(lineFromItem(item, [product({ groups: [] })])).toBeNull();
    const off = product();
    off.groups[0]!.options[0]!.available = false;
    expect(lineFromItem(item, [off])).toBeNull();
  });
});
