export const ORDER_TYPES = ['counter', 'takeout', 'delivery', 'table'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  counter: 'Balcão',
  takeout: 'Retirada',
  delivery: 'Delivery',
  table: 'Mesa',
};

/** Situação administrativa do pedido. */
export const ORDER_STATUSES = ['pending', 'open', 'closed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Aguardando aceite',
  open: 'Em aberto',
  closed: 'Finalizado',
  cancelled: 'Cancelado',
};

const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['open', 'cancelled'],
  open: ['closed', 'cancelled'],
  closed: ['open'], // somente via reabertura auditada
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** Etapa de produção/atendimento (o que o cliente acompanha). */
export const ORDER_STAGES = ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered'] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];
export const ORDER_STAGE_LABEL: Record<OrderStage, string> = {
  received: 'Recebido',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
};

export const KITCHEN_STATUSES = ['received', 'preparing', 'ready'] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];
export const KITCHEN_STATUS_LABEL: Record<KitchenStatus, string> = {
  received: 'Recebido',
  preparing: 'Em preparo',
  ready: 'Pronto',
};
const KITCHEN_TRANSITIONS: Record<KitchenStatus, KitchenStatus[]> = {
  received: ['preparing', 'ready'],
  preparing: ['ready', 'received'],
  ready: ['preparing'], // desfazer "pronto" por engano
};
export function canTransitionKitchen(from: KitchenStatus, to: KitchenStatus): boolean {
  return KITCHEN_TRANSITIONS[from].includes(to);
}

export const DELIVERY_STATUSES = ['waiting', 'en_route', 'delivered', 'issue'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  waiting: 'Aguardando saída',
  en_route: 'Em rota',
  delivered: 'Entregue',
  issue: 'Ocorrência',
};
const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  waiting: ['en_route'],
  en_route: ['delivered', 'issue'],
  issue: ['en_route', 'delivered', 'waiting'],
  delivered: [],
};
export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

/**
 * Etapa do pedido derivada dos tickets da cozinha (enquanto não saiu para entrega).
 * Sem tickets (ex.: só bebidas) -> pronto.
 */
export function stageFromTickets(statuses: KitchenStatus[]): OrderStage {
  if (statuses.length === 0) return 'ready';
  if (statuses.every((s) => s === 'ready')) return 'ready';
  if (statuses.some((s) => s === 'preparing' || s === 'ready')) return 'preparing';
  return 'received';
}

export const CASH_MOVEMENT_TYPES = [
  'opening',
  'supply',
  'withdrawal',
  'payment',
  'refund',
  'courier_payout',
  'expense',
] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];
export const CASH_MOVEMENT_LABEL: Record<CashMovementType, string> = {
  opening: 'Abertura (fundo de troco)',
  supply: 'Suprimento',
  withdrawal: 'Sangria',
  payment: 'Recebimento',
  refund: 'Estorno',
  courier_payout: 'Repasse a entregador',
  expense: 'Despesa paga no caixa',
};

export const STOCK_MOVEMENT_TYPES = ['entry', 'sale', 'sale_reversal', 'loss', 'adjustment', 'manual_out'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const STOCK_MOVEMENT_LABEL: Record<StockMovementType, string> = {
  entry: 'Entrada',
  sale: 'Baixa por venda',
  sale_reversal: 'Estorno de venda',
  loss: 'Perda',
  adjustment: 'Ajuste de inventário',
  manual_out: 'Saída manual',
};
