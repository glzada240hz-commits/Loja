import { describe, expect, it } from 'vitest';
import { cashPayment, computeOrderTotals, effectiveDiscountBp, itemTotal, validateOptionSelections } from '../src/pricing.js';

describe('cálculo do pedido', () => {
  const items = [
    { unitPriceCents: 1890, quantity: 2, options: [{ priceCents: 400, quantity: 1 }] },
    { unitPriceCents: 4090, quantity: 1, options: [] },
    { unitPriceCents: 999, quantity: 3, options: [], cancelled: true },
  ];
  it('itens com adicionais', () => {
    expect(itemTotal(items[0]!)).toBe(4580);
  });
  it('desconto só nos itens; entrega separada; cancelados fora', () => {
    const t = computeOrderTotals({ items, discount: { type: 'percent', value: 1000 }, deliveryFeeCents: 500 });
    expect(t).toEqual({ subtotalCents: 8670, discountCents: 867, deliveryFeeCents: 500, totalCents: 8303 });
  });
  it('desconto em valor limitado ao subtotal', () => {
    const t = computeOrderTotals({ items, discount: { type: 'amount', value: 100000 }, deliveryFeeCents: 700 });
    expect(t.totalCents).toBe(700);
  });
  it('rejeita valores inválidos', () => {
    expect(() => computeOrderTotals({ items: [{ unitPriceCents: 10.5, quantity: 1, options: [] }], discount: null, deliveryFeeCents: 0 })).toThrow();
    expect(() => computeOrderTotals({ items: [{ unitPriceCents: 100, quantity: 0, options: [] }], discount: null, deliveryFeeCents: 0 })).toThrow();
    expect(() => computeOrderTotals({ items, discount: { type: 'percent', value: 10001 }, deliveryFeeCents: 0 })).toThrow();
    expect(() => computeOrderTotals({ items, discount: null, deliveryFeeCents: -1 })).toThrow();
  });
  it('percentual efetivo arredonda para cima (protege o limite)', () => {
    expect(effectiveDiscountBp(10000, 1000)).toBe(1000);
    expect(effectiveDiscountBp(9999, 1000)).toBe(1001);
  });
});

describe('troco', () => {
  it('aplica o saldo e devolve o restante', () => {
    expect(cashPayment(3790, 5000)).toEqual({ appliedCents: 3790, changeCents: 1210 });
    expect(cashPayment(3790, 2000)).toEqual({ appliedCents: 2000, changeCents: 0 });
    expect(cashPayment(3790, 5000, 1000)).toEqual({ appliedCents: 1000, changeCents: 4000 });
    expect(() => cashPayment(0, 100)).toThrow();
    expect(() => cashPayment(100, 100, 200)).toThrow();
  });
});

describe('regras de adicionais', () => {
  const groups = [
    { id: 'g1', name: 'Ponto', minSelect: 1, maxSelect: 1, options: [{ id: 'a', name: 'Mal', available: true }, { id: 'b', name: 'Bem', available: true }] },
    { id: 'g2', name: 'Extras', minSelect: 0, maxSelect: 2, options: [{ id: 'c', name: 'Bacon', available: false }, { id: 'd', name: 'Ovo', available: true }] },
  ];
  it('mínimo, máximo, indisponível, estranho e repetido', () => {
    expect(validateOptionSelections(groups, [{ optionId: 'a', quantity: 1 }])).toEqual([]);
    expect(validateOptionSelections(groups, [])).toEqual(['Escolha pelo menos 1 em "Ponto"']);
    expect(validateOptionSelections(groups, [{ optionId: 'a', quantity: 1 }, { optionId: 'b', quantity: 1 }])[0]).toMatch(/no máximo 1/);
    expect(validateOptionSelections(groups, [{ optionId: 'a', quantity: 1 }, { optionId: 'c', quantity: 1 }])[0]).toMatch(/indisponível/);
    expect(validateOptionSelections(groups, [{ optionId: 'a', quantity: 1 }, { optionId: 'zz', quantity: 1 }])[0]).toMatch(/não pertence/);
    expect(validateOptionSelections(groups, [{ optionId: 'a', quantity: 1 }, { optionId: 'a', quantity: 1 }])[0]).toMatch(/repetido/);
    expect(validateOptionSelections(groups, [{ optionId: 'a', quantity: 1 }, { optionId: 'd', quantity: 3 }])[0]).toMatch(/no máximo 2/);
  });
});
