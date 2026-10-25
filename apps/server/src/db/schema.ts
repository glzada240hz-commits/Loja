import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
/** Quantidades de estoque com 3 casas decimais (exatas, numeric). Lidas como string. */
const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const roleEnum = pgEnum('role', ['admin', 'manager', 'cashier', 'kitchen', 'courier']);
export const orderTypeEnum = pgEnum('order_type', ['counter', 'takeout', 'delivery', 'table']);
export const orderStatusEnum = pgEnum('order_status', ['pending', 'open', 'closed', 'cancelled']);
export const orderStageEnum = pgEnum('order_stage', ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered']);
export const orderSourceEnum = pgEnum('order_source', ['pos', 'online', 'whatsapp']);
export const kitchenStatusEnum = pgEnum('kitchen_status', ['received', 'preparing', 'ready']);
export const deliveryStatusEnum = pgEnum('delivery_status', ['waiting', 'en_route', 'delivered', 'issue']);
export const paymentMethodEnum = pgEnum('payment_method', [
  'cash',
  'pix_manual',
  'pix_integrated',
  'credit',
  'debit',
  'voucher',
]);
export const paymentStatusEnum = pgEnum('payment_status', ['confirmed', 'refunded']);
export const cashMovementTypeEnum = pgEnum('cash_movement_type', [
  'opening',
  'supply',
  'withdrawal',
  'payment',
  'refund',
  'courier_payout',
  'expense',
]);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', [
  'entry',
  'sale',
  'sale_reversal',
  'loss',
  'adjustment',
  'manual_out',
]);
export const waDirectionEnum = pgEnum('wa_direction', ['in', 'out']);
export const waStatusEnum = pgEnum('wa_status', ['received', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed']);

// ---------------- Usuários e sessões ----------------

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  active: boolean('active').notNull().default(true),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    authorizedBy: uuid('authorized_by').references(() => users.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_created_idx').on(t.createdAt)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    response: jsonb('response'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

// ---------------- Dia operacional e caixa ----------------

export const businessDays = pgTable(
  'business_days',
  {
    id: id(),
    referenceDate: text('reference_date').notNull(), // data local de abertura (YYYY-MM-DD)
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
    openedAt: ts('opened_at').notNull(),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => users.id),
    closedAt: ts('closed_at'),
    closedBy: uuid('closed_by').references(() => users.id),
    lastOrderNumber: integer('last_order_number').notNull().default(0),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('business_days_one_open').on(t.status).where(sql`status = 'open'`)],
);

export const cashSessions = pgTable(
  'cash_sessions',
  {
    id: id(),
    businessDayId: uuid('business_day_id')
      .notNull()
      .references(() => businessDays.id),
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
    openedAt: ts('opened_at').notNull(),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => users.id),
    openingCents: integer('opening_cents').notNull(),
    closedAt: ts('closed_at'),
    closedBy: uuid('closed_by').references(() => users.id),
    expectedCashCents: integer('expected_cash_cents'),
    countedCashCents: integer('counted_cash_cents'),
    differenceCents: integer('difference_cents'),
    justification: text('justification'),
    summary: jsonb('summary'),
  },
  (t) => [uniqueIndex('cash_sessions_one_open').on(t.status).where(sql`status = 'open'`)],
);

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: id(),
    cashSessionId: uuid('cash_session_id')
      .notNull()
      .references(() => cashSessions.id),
    type: cashMovementTypeEnum('type').notNull(),
    method: paymentMethodEnum('method').notNull().default('cash'),
    /** Positivo = entrada; negativo = saída. */
    amountCents: integer('amount_cents').notNull(),
    reason: text('reason'),
    paymentId: uuid('payment_id'),
    orderId: uuid('order_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    authorizedBy: uuid('authorized_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('cash_mov_session_idx').on(t.cashSessionId),
    // impede lançamento duplicado do mesmo recebimento/estorno
    uniqueIndex('cash_mov_payment_unique').on(t.paymentId, t.type).where(sql`payment_id is not null`),
  ],
);

// ---------------- Clientes e bairros ----------------

export const neighborhoods = pgTable('neighborhoods', {
  id: id(),
  name: text('name').notNull().unique(),
  feeCents: integer('fee_cents').notNull(),
  courierFeeCents: integer('courier_fee_cents'),
  minOrderCents: integer('min_order_cents').notNull().default(0),
  etaMinutes: integer('eta_minutes').notNull().default(45),
  active: boolean('active').notNull().default(true),
});

export const customers = pgTable(
  'customers',
  {
    id: id(),
    name: text('name').notNull(),
    phone: text('phone'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    anonymizedAt: ts('anonymized_at'),
  },
  (t) => [uniqueIndex('customers_phone_unique').on(t.phone).where(sql`phone is not null`)],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: id(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    street: text('street').notNull(),
    number: text('number').notNull(),
    complement: text('complement'),
    neighborhoodId: uuid('neighborhood_id').references(() => neighborhoods.id),
    neighborhoodName: text('neighborhood_name').notNull(),
    reference: text('reference'),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
  },
  (t) => [index('addr_customer_idx').on(t.customerId)],
);

// ---------------- Cardápio ----------------

export const categories = pgTable('categories', {
  id: id(),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  sendToKitchen: boolean('send_to_kitchen').notNull().default(true),
});

export const products = pgTable(
  'products',
  {
    id: id(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    code: text('code'), // atalho numérico na tela de venda
    name: text('name').notNull(),
    description: text('description'),
    imagePath: text('image_path'),
    kind: text('kind', { enum: ['simple', 'combo'] }).notNull().default('simple'),
    available: boolean('available').notNull().default(true),
    active: boolean('active').notNull().default(true),
    showOnline: boolean('show_online').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('products_code_unique').on(t.code).where(sql`code is not null and active`)],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Único'),
    priceCents: integer('price_cents').notNull(),
    costCents: integer('cost_cents'),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    available: boolean('available').notNull().default(true),
  },
  (t) => [check('variant_price_nonneg', sql`${t.priceCents} >= 0`)],
);

export const optionGroups = pgTable(
  'option_groups',
  {
    id: id(),
    name: text('name').notNull(),
    minSelect: integer('min_select').notNull().default(0),
    maxSelect: integer('max_select').notNull().default(0), // 0 = sem limite
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [check('group_limits', sql`${t.minSelect} >= 0 and ${t.maxSelect} >= 0`)],
);

export const options = pgTable('options', {
  id: id(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => optionGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull().default(0),
  costCents: integer('cost_cents'),
  available: boolean('available').notNull().default(true),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

export const productOptionGroups = pgTable(
  'product_option_groups',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
);

export const comboItems = pgTable('combo_items', {
  id: id(),
  comboProductId: uuid('combo_product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  componentVariantId: uuid('component_variant_id')
    .notNull()
    .references(() => productVariants.id),
  quantity: integer('quantity').notNull().default(1),
});

// ---------------- Estoque ----------------

export const stockItems = pgTable('stock_items', {
  id: id(),
  name: text('name').notNull().unique(),
  unit: text('unit').notNull().default('un'),
  quantity: qty('quantity').notNull().default('0'),
  minQuantity: qty('min_quantity').notNull().default('0'),
  /** custo por unidade em centavos (pode ter frações de centavo). */
  unitCostCents: numeric('unit_cost_cents', { precision: 14, scale: 4 }),
  active: boolean('active').notNull().default(true),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const recipeItems = pgTable(
  'recipe_items',
  {
    id: id(),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id').references(() => options.id, { onDelete: 'cascade' }),
    stockItemId: uuid('stock_item_id')
      .notNull()
      .references(() => stockItems.id),
    quantity: qty('quantity').notNull(),
  },
  (t) => [check('recipe_target', sql`(${t.variantId} is null) <> (${t.optionId} is null)`)],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    stockItemId: uuid('stock_item_id')
      .notNull()
      .references(() => stockItems.id),
    type: stockMovementTypeEnum('type').notNull(),
    quantity: qty('quantity').notNull(), // com sinal
    unitCostCents: numeric('unit_cost_cents', { precision: 14, scale: 4 }),
    reason: text('reason'),
    sourceType: text('source_type'),
    sourceId: text('source_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_mov_item_idx').on(t.stockItemId),
    // garante que um mesmo item de pedido nunca baixe (ou estorne) o estoque duas vezes
    uniqueIndex('stock_mov_source_unique')
      .on(t.sourceType, t.sourceId, t.stockItemId, t.type)
      .where(sql`source_id is not null`),
  ],
);

// ---------------- Entregadores ----------------

export const couriers = pgTable('couriers', {
  id: id(),
  name: text('name').notNull(),
  phone: text('phone'),
  userId: uuid('user_id')
    .references(() => users.id)
    .unique(),
  defaultFeeCents: integer('default_fee_cents').notNull().default(0),
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  createdAt: createdAt(),
});

export const deliveryRuns = pgTable('delivery_runs', {
  id: id(),
  businessDayId: uuid('business_day_id')
    .notNull()
    .references(() => businessDays.id),
  courierId: uuid('courier_id')
    .notNull()
    .references(() => couriers.id),
  status: text('status', { enum: ['assigned', 'en_route', 'finished'] }).notNull().default('assigned'),
  createdAt: createdAt(),
  createdBy: uuid('created_by').references(() => users.id),
  departedAt: ts('departed_at'),
  finishedAt: ts('finished_at'),
});

export const courierSettlements = pgTable('courier_settlements', {
  id: id(),
  courierId: uuid('courier_id')
    .notNull()
    .references(() => couriers.id),
  deliveriesCount: integer('deliveries_count').notNull(),
  deliveryFeesCents: integer('delivery_fees_cents').notNull(),
  adjustmentsCents: integer('adjustments_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  paidFromCash: boolean('paid_from_cash').notNull().default(false),
  cashMovementId: uuid('cash_movement_id'),
  notes: text('notes'),
  createdAt: createdAt(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
});

export const courierAdjustments = pgTable('courier_adjustments', {
  id: id(),
  courierId: uuid('courier_id')
    .notNull()
    .references(() => couriers.id),
  businessDayId: uuid('business_day_id').references(() => businessDays.id),
  type: text('type', { enum: ['bonus', 'deduction'] }).notNull(),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull(),
  settlementId: uuid('settlement_id').references(() => courierSettlements.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

// ---------------- Pedidos ----------------

export const orders = pgTable(
  'orders',
  {
    id: id(),
    businessDayId: uuid('business_day_id')
      .notNull()
      .references(() => businessDays.id),
    number: integer('number').notNull(),
    type: orderTypeEnum('type').notNull(),
    source: orderSourceEnum('source').notNull().default('pos'),
    status: orderStatusEnum('status').notNull(),
    stage: orderStageEnum('stage').notNull().default('received'),
    tableLabel: text('table_label'),
    customerId: uuid('customer_id').references(() => customers.id),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    addrStreet: text('addr_street'),
    addrNumber: text('addr_number'),
    addrComplement: text('addr_complement'),
    addrReference: text('addr_reference'),
    neighborhoodId: uuid('neighborhood_id').references(() => neighborhoods.id),
    neighborhoodName: text('neighborhood_name'),
    notes: text('notes'),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    discountType: text('discount_type', { enum: ['amount', 'percent'] }),
    discountValue: integer('discount_value'),
    discountCents: integer('discount_cents').notNull().default(0),
    discountReason: text('discount_reason'),
    discountBy: uuid('discount_by').references(() => users.id),
    deliveryFeeCents: integer('delivery_fee_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    paidCents: integer('paid_cents').notNull().default(0),
    /** forma de pagamento escolhida pelo cliente (pedido online), apenas intenção */
    paymentIntent: paymentMethodEnum('payment_intent'),
    changeForCents: integer('change_for_cents'),
    etaAt: ts('eta_at'),
    receivable: boolean('receivable').notNull().default(false),
    trackingToken: text('tracking_token').unique(),
    waOptIn: boolean('wa_opt_in').notNull().default(false),
    // entrega
    courierId: uuid('courier_id').references(() => couriers.id),
    deliveryRunId: uuid('delivery_run_id').references(() => deliveryRuns.id),
    deliveryStatus: deliveryStatusEnum('delivery_status'),
    courierFeeCents: integer('courier_fee_cents'),
    deliveryIssue: text('delivery_issue'),
    courierSettlementId: uuid('courier_settlement_id').references(() => courierSettlements.id),
    // auditoria/tempos
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    acceptedAt: ts('accepted_at'),
    readyAt: ts('ready_at'),
    dispatchedAt: ts('dispatched_at'),
    deliveredAt: ts('delivered_at'),
    closedAt: ts('closed_at'),
    closedBy: uuid('closed_by').references(() => users.id),
    cancelledAt: ts('cancelled_at'),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('orders_day_number').on(t.businessDayId, t.number),
    index('orders_status_idx').on(t.status),
    index('orders_phone_idx').on(t.customerPhone),
    index('orders_created_idx').on(t.createdAt),
    index('orders_courier_idx').on(t.courierId),
    check('orders_money', sql`${t.totalCents} >= 0 and ${t.paidCents} >= 0 and ${t.discountCents} >= 0`),
  ],
);

export const kitchenTickets = pgTable(
  'kitchen_tickets',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    status: kitchenStatusEnum('status').notNull().default('received'),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    readyAt: ts('ready_at'),
    changedAt: ts('changed_at'),
    changeNote: text('change_note'),
  },
  (t) => [uniqueIndex('ticket_order_round').on(t.orderId, t.round), index('ticket_status_idx').on(t.status)],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id),
    variantId: uuid('variant_id').references(() => productVariants.id),
    productName: text('product_name').notNull(),
    variantName: text('variant_name'),
    categoryName: text('category_name'),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    optionsUnitCents: integer('options_unit_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    /** custo unitário (produto + adicionais); null quando algum custo não está cadastrado */
    unitCostCents: integer('unit_cost_cents'),
    sendToKitchen: boolean('send_to_kitchen').notNull().default(true),
    notes: text('notes'),
    comboComponents: jsonb('combo_components'),
    status: text('status', { enum: ['active', 'cancelled'] }).notNull().default('active'),
    ticketId: uuid('ticket_id').references(() => kitchenTickets.id),
    /** momento em que o item foi lançado (enviado à cozinha / baixado do estoque) */
    sentAt: ts('sent_at'),
    stockDeducted: boolean('stock_deducted').notNull().default(false),
    cancelledAt: ts('cancelled_at'),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), check('item_qty', sql`${t.quantity} between 1 and 99`)],
);

export const orderItemOptions = pgTable('order_item_options', {
  id: id(),
  orderItemId: uuid('order_item_id')
    .notNull()
    .references(() => orderItems.id, { onDelete: 'cascade' }),
  optionId: uuid('option_id').references(() => options.id),
  groupName: text('group_name').notNull(),
  optionName: text('option_name').notNull(),
  priceCents: integer('price_cents').notNull(),
  costCents: integer('cost_cents'),
  quantity: integer('quantity').notNull().default(1),
});

export const orderEvents = pgTable(
  'order_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    data: jsonb('data'),
    userId: uuid('user_id').references(() => users.id),
    authorizedBy: uuid('authorized_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId)],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    method: paymentMethodEnum('method').notNull(),
    amountCents: integer('amount_cents').notNull(),
    tenderedCents: integer('tendered_cents'),
    changeCents: integer('change_cents').notNull().default(0),
    status: paymentStatusEnum('status').notNull().default('confirmed'),
    payerLabel: text('payer_label'),
    providerRef: text('provider_ref'),
    note: text('note'),
    cashSessionId: uuid('cash_session_id')
      .notNull()
      .references(() => cashSessions.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    refundedAt: ts('refunded_at'),
    refundedBy: uuid('refunded_by').references(() => users.id),
    refundReason: text('refund_reason'),
    refundCashSessionId: uuid('refund_cash_session_id').references(() => cashSessions.id),
  },
  (t) => [index('payments_order_idx').on(t.orderId), check('payment_positive', sql`${t.amountCents} > 0`)],
);

// ---------------- Despesas ----------------

export const expenses = pgTable('expenses', {
  id: id(),
  date: text('date').notNull(), // YYYY-MM-DD
  businessDayId: uuid('business_day_id').references(() => businessDays.id),
  category: text('category').notNull(),
  description: text('description').notNull(),
  amountCents: integer('amount_cents').notNull(),
  paidFromCash: boolean('paid_from_cash').notNull().default(false),
  cashMovementId: uuid('cash_movement_id'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  deletedAt: ts('deleted_at'),
});

// ---------------- WhatsApp ----------------

export const waContacts = pgTable('wa_contacts', {
  id: id(),
  waId: text('wa_id').notNull().unique(),
  profileName: text('profile_name'),
  customerId: uuid('customer_id').references(() => customers.id),
  lastInboundAt: ts('last_inbound_at'),
  lastMessageAt: ts('last_message_at'),
  unreadCount: integer('unread_count').notNull().default(0),
  botPaused: boolean('bot_paused').notNull().default(false),
  needsHuman: boolean('needs_human').notNull().default(false),
  optInOrderUpdates: boolean('opt_in_order_updates').notNull().default(false),
  optInMarketing: boolean('opt_in_marketing').notNull().default(false),
  optInAt: ts('opt_in_at'),
  optInSource: text('opt_in_source'),
  optOutAt: ts('opt_out_at'),
  createdAt: createdAt(),
});

export const waMessages = pgTable(
  'wa_messages',
  {
    id: id(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => waContacts.id, { onDelete: 'cascade' }),
    direction: waDirectionEnum('direction').notNull(),
    wamid: text('wamid').unique(),
    type: text('type').notNull().default('text'),
    body: text('body'),
    templateName: text('template_name'),
    templateParams: jsonb('template_params'),
    status: waStatusEnum('status').notNull(),
    statusAt: ts('status_at'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at'),
    /** chave para evitar mensagem automática duplicada (ex.: order:<id>:accepted) */
    dedupeKey: text('dedupe_key').unique(),
    orderId: uuid('order_id').references(() => orders.id),
    automated: boolean('automated').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('wa_msg_contact_idx').on(t.contactId, t.createdAt), index('wa_msg_queue_idx').on(t.status, t.nextAttemptAt)],
);

export const waWebhookEvents = pgTable('wa_webhook_events', {
  id: id(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  kind: text('kind').notNull(), // message | status
  payload: jsonb('payload').notNull(),
  status: text('status', { enum: ['pending', 'processed', 'failed'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  receivedAt: createdAt(),
  processedAt: ts('processed_at'),
  nextAttemptAt: ts('next_attempt_at'),
});

export const quickReplies = pgTable('quick_replies', {
  id: id(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  sort: integer('sort').notNull().default(0),
});

export const waTemplates = pgTable('wa_templates', {
  id: id(),
  purpose: text('purpose').notNull().unique(), // order_accepted, order_ready, order_dispatched, order_cancelled...
  name: text('name').notNull(),
  language: text('language').notNull().default('pt_BR'),
  bodyPreview: text('body_preview').notNull(),
  active: boolean('active').notNull().default(true),
});
