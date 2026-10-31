import type { CartLine, MenuProduct, OrderItem } from './types';

/**
 * Reconstrói um item de pedido anterior como linha nova, usando o cardápio ATUAL (preço e
 * disponibilidade de hoje; o servidor recalcula tudo ao gravar). Devolve null se o produto,
 * o tamanho ou algum adicional não existir mais ou estiver indisponível.
 */
export function lineFromItem(i: Pick<OrderItem, 'productName' | 'variantName' | 'options' | 'notes'>, products: MenuProduct[], quantity = 1): CartLine | null {
  const p = products.find((x) => x.name === i.productName);
  const v = p?.variants.find((x) => (i.variantName ? x.name === i.variantName : true));
  if (!p || !v || !p.available || !v.available) return null;
  const opts = p.groups.flatMap((g) => g.options);
  const options = i.options.map((o) => {
    const m = opts.find((x) => x.name === o.optionName);
    return m && m.available ? { optionId: m.id, name: m.name, priceCents: m.priceCents, quantity: o.quantity } : null;
  });
  if (options.some((x) => !x)) return null;
  return {
    key: Math.random().toString(36).slice(2),
    variantId: v.id,
    productName: p.name,
    variantName: v.name === 'Único' ? null : v.name,
    unitPriceCents: v.priceCents,
    options: options as CartLine['options'],
    quantity,
    notes: i.notes ?? '',
  };
}
