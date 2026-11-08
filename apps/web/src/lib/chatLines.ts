import type { ChatItem } from '@guto/core';
import type { CartLine, MenuCategory } from './types';

/** Itens reconhecidos no print → linhas do carrinho com o preço de hoje (indisponíveis ficam de fora). */
export function chatItemsToLines(items: ChatItem[], menu: MenuCategory[] | undefined): { lines: CartLine[]; skipped: string[] } {
  const lines: CartLine[] = [];
  const skipped: string[] = [];
  for (const it of items) {
    const p = menu?.flatMap((c) => c.products).find((x) => x.id === it.productId);
    const v = p?.variants.find((x) => x.id === it.variantId);
    if (!p || !v || !p.available || !v.available) {
      skipped.push(it.name);
      continue;
    }
    lines.push({ key: Math.random().toString(36).slice(2), variantId: v.id, productName: p.name, variantName: v.name === 'Único' ? null : v.name, unitPriceCents: v.priceCents, options: [], quantity: Math.min(99, it.quantity), notes: '' });
  }
  return { lines, skipped };
}
