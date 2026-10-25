import { assertCents, percentOf, type Cents } from './money.js';

export interface PricedOption {
  priceCents: Cents;
  quantity: number;
}

export interface PricedItem {
  unitPriceCents: Cents;
  quantity: number;
  options: PricedOption[];
  cancelled?: boolean;
}

export type DiscountInput =
  | { type: 'amount'; value: Cents }
  | { type: 'percent'; value: number } // pontos-base: 1000 = 10%
  | null;

export interface OrderTotals {
  subtotalCents: Cents;
  discountCents: Cents;
  deliveryFeeCents: Cents;
  totalCents: Cents;
}

export const MAX_ITEM_QUANTITY = 99;

function assertQuantity(q: number, label: string) {
  if (!Number.isInteger(q) || q < 1 || q > MAX_ITEM_QUANTITY) {
    throw new RangeError(`${label}: quantidade inválida`);
  }
}

/** Preço de uma unidade do item, incluindo adicionais. */
export function unitTotal(item: Pick<PricedItem, 'unitPriceCents' | 'options'>): Cents {
  let t = assertCents(item.unitPriceCents, 'preço');
  if (t < 0) throw new RangeError('preço negativo');
  for (const o of item.options) {
    assertQuantity(o.quantity, 'adicional');
    if (assertCents(o.priceCents, 'preço do adicional') < 0) throw new RangeError('adicional negativo');
    t += o.priceCents * o.quantity;
  }
  return t;
}

export function itemTotal(item: PricedItem): Cents {
  assertQuantity(item.quantity, 'item');
  return assertCents(unitTotal(item) * item.quantity, 'total do item');
}

export function discountAmount(subtotal: Cents, discount: DiscountInput): Cents {
  if (!discount) return 0;
  if (discount.type === 'amount') {
    assertCents(discount.value, 'desconto');
    if (discount.value < 0) throw new RangeError('desconto negativo');
    return Math.min(discount.value, subtotal);
  }
  if (!Number.isInteger(discount.value) || discount.value < 0 || discount.value > 10000) {
    throw new RangeError('percentual de desconto deve estar entre 0% e 100%');
  }
  return Math.min(percentOf(subtotal, discount.value), subtotal);
}

/**
 * Cálculo oficial do pedido. O desconto incide apenas sobre os itens;
 * a taxa de entrega é somada separadamente e nunca recebe desconto.
 */
export function computeOrderTotals(input: {
  items: PricedItem[];
  discount: DiscountInput;
  deliveryFeeCents: Cents;
}): OrderTotals {
  assertCents(input.deliveryFeeCents, 'taxa de entrega');
  if (input.deliveryFeeCents < 0) throw new RangeError('taxa de entrega negativa');
  let subtotal = 0;
  for (const it of input.items) {
    if (it.cancelled) continue;
    subtotal += itemTotal(it);
  }
  assertCents(subtotal, 'subtotal');
  const discountCents = discountAmount(subtotal, input.discount);
  return {
    subtotalCents: subtotal,
    discountCents,
    deliveryFeeCents: input.deliveryFeeCents,
    totalCents: subtotal - discountCents + input.deliveryFeeCents,
  };
}

/** Percentual efetivo (em pontos-base) de um desconto sobre o subtotal. */
export function effectiveDiscountBp(subtotal: Cents, discountCents: Cents): number {
  if (subtotal <= 0) return discountCents > 0 ? 10000 : 0;
  return Math.ceil((discountCents * 10000) / subtotal);
}

export type PaymentMethod = 'cash' | 'pix_manual' | 'pix_integrated' | 'credit' | 'debit' | 'voucher';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  pix_manual: 'Pix (conferido manualmente)',
  pix_integrated: 'Pix (integrado)',
  credit: 'Cartão de crédito',
  debit: 'Cartão de débito',
  voucher: 'Vale-refeição',
};

export interface CashPaymentResult {
  appliedCents: Cents;
  changeCents: Cents;
}

/**
 * Pagamento em dinheiro: o cliente entrega `tendered`; aplica-se no máximo o saldo devedor
 * e o restante é troco. Ex.: saldo 3790, entregou 5000 -> aplica 3790, troco 1210.
 */
export function cashPayment(balance: Cents, tendered: Cents, applyCents?: Cents): CashPaymentResult {
  assertCents(balance);
  assertCents(tendered);
  if (balance <= 0) throw new RangeError('pedido já está quitado');
  if (tendered <= 0) throw new RangeError('valor recebido deve ser positivo');
  const target = applyCents ?? balance;
  assertCents(target);
  if (target <= 0 || target > balance) throw new RangeError('valor a aplicar inválido');
  const applied = Math.min(tendered, target);
  return { appliedCents: applied, changeCents: tendered - applied };
}

export function balanceOf(totalCents: Cents, paidCents: Cents): Cents {
  return assertCents(totalCents - paidCents);
}

// ---------- Validação de adicionais ----------

export interface OptionGroupRule {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { id: string; name: string; available: boolean }[];
}

export interface OptionSelection {
  optionId: string;
  quantity: number;
}

/** Retorna lista de erros legíveis (vazia = válido). */
export function validateOptionSelections(groups: OptionGroupRule[], selected: OptionSelection[]): string[] {
  const errors: string[] = [];
  const byOption = new Map<string, { group: OptionGroupRule; name: string; available: boolean }>();
  for (const g of groups) for (const o of g.options) byOption.set(o.id, { group: g, name: o.name, available: o.available });
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const s of selected) {
    const ref = byOption.get(s.optionId);
    if (!ref) {
      errors.push('Adicional não pertence a este produto');
      continue;
    }
    if (seen.has(s.optionId)) {
      errors.push(`Adicional "${ref.name}" repetido`);
      continue;
    }
    seen.add(s.optionId);
    if (!ref.available) errors.push(`"${ref.name}" está indisponível no momento`);
    if (!Number.isInteger(s.quantity) || s.quantity < 1 || s.quantity > 10) {
      errors.push(`Quantidade inválida para "${ref.name}"`);
      continue;
    }
    counts.set(ref.group.id, (counts.get(ref.group.id) ?? 0) + s.quantity);
  }
  for (const g of groups) {
    const c = counts.get(g.id) ?? 0;
    if (c < g.minSelect) errors.push(`Escolha pelo menos ${g.minSelect} em "${g.name}"`);
    if (g.maxSelect > 0 && c > g.maxSelect) errors.push(`Escolha no máximo ${g.maxSelect} em "${g.name}"`);
  }
  return errors;
}
