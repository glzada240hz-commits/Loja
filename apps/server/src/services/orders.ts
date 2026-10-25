import { and, asc, desc, eq, gte, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  can,
  cashPayment,
  computeOrderTotals,
  effectiveDiscountBp,
  normalizePhoneBR,
  stageFromTickets,
  splitEvenly,
  type DiscountInput,
  type KitchenStatus,
  type OrderType,
  type PaymentMethod,
} from '@guto/core';
import type { DbOrTx, Tx } from '../db/index.js';
import {
  businessDays,
  couriers,
  customerAddresses,
  customers,
  kitchenTickets,
  neighborhoods,
  orderEvents,
  orderItemOptions,
  orderItems,
  orders,
  payments,
  cashMovements,
  users,
} from '../db/schema.js';
import { audit, orderEvent } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Actor, type Ctx } from '../lib/context.js';
import { randomToken } from '../lib/crypto.js';
import type { LiveEvent } from '../lib/events.js';
import { AppError, badRequest, conflict, notFound, staleVersion, unprocessable } from '../lib/errors.js';
import { idempotent, type IdemKey } from '../lib/idempotency.js';
import { enqueueOrderNotification } from '../whatsapp/notify.js';
import { authorize, type SupervisorInput } from './auth.js';
import { nextOrderNumber, requireOpenDay } from './businessDay.js';
import { requireOpenCash } from './cash.js';
import { resolveItems, type ItemInput, type ResolvedItem } from './menu.js';
import { getSettings } from './settings.js';
import { deductForItem, reverseForItem } from './stock.js';

type Emit = (e: LiveEvent) => void;
type OrderRow = typeof orders.$inferSelect;

export interface CustomerInput {
  name?: string | null;
  phone?: string | null;
}
export interface AddressInput {
  street: string;
  number: string;
  complement?: string | null;
  reference?: string | null;
  neighborhoodId: string;
}
export interface DiscountSpec {
  type: 'amount' | 'percent';
  value: number; // centavos ou pontos-base
  reason: string;
}

export interface CreateOrderInput {
  type: OrderType;
  source?: 'pos' | 'online' | 'whatsapp';
  tableLabel?: string | null;
  customer?: CustomerInput | null;
  address?: AddressInput | null;
  notes?: string | null;
  items: ItemInput[];
  discount?: DiscountSpec | null;
  deliveryFeeCents?: number | null;
  etaMinutes?: number | null;
  send?: boolean;
  confirmDuplicate?: boolean;
  paymentIntent?: PaymentMethod | null;
  changeForCents?: number | null;
  waOptIn?: boolean;
}

// ---------------- utilidades internas ----------------

async function lockOrder(tx: Tx, orderId: string): Promise<OrderRow> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!o) throw notFound('Pedido não encontrado');
  return o;
}

function checkVersion(o: OrderRow, version: number | undefined) {
  if (version === undefined || version === null) throw badRequest('Versão do pedido não informada');
  if (o.version !== version) throw staleVersion();
}

function requireEditable(o: OrderRow) {
  if (o.status === 'closed') throw new AppError(409, 'order_closed', 'Pedido finalizado. Reabra o pedido para alterá-lo.');
  if (o.status === 'cancelled') throw new AppError(409, 'order_cancelled', 'Pedido cancelado não pode ser alterado');
}

async function bump(tx: Tx, orderId: string, set: Partial<OrderRow> = {}) {
  await tx
    .update(orders)
    .set({ ...set, version: sql`${orders.version} + 1`, updatedAt: now() })
    .where(eq(orders.id, orderId));
}

function discountInput(o: Pick<OrderRow, 'discountType' | 'discountValue'>): DiscountInput {
  if (!o.discountType || o.discountValue == null) return null;
  return { type: o.discountType, value: o.discountValue };
}

/** Recalcula totais do pedido a partir dos itens gravados (fonte oficial). */
async function recalc(tx: Tx, orderId: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const opts = items.length
    ? await tx.select().from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, items.map((i) => i.id)))
    : [];
  const totals = computeOrderTotals({
    items: items.map((i) => ({
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      cancelled: i.status === 'cancelled',
      options: opts.filter((x) => x.orderItemId === i.id).map((x) => ({ priceCents: x.priceCents, quantity: x.quantity })),
    })),
    discount: discountInput(o!),
    deliveryFeeCents: o!.deliveryFeeCents,
  });
  // conferência: soma armazenada por item deve bater com o recálculo
  for (const i of items) {
    const unit = i.unitPriceCents + opts.filter((x) => x.orderItemId === i.id).reduce((a, x) => a + x.priceCents * x.quantity, 0);
    if (unit * i.quantity !== i.totalCents || unit - i.unitPriceCents !== i.optionsUnitCents) {
      throw new AppError(500, 'integrity', `Inconsistência no item ${i.productName}`);
    }
  }
  if (totals.totalCents < o!.paidCents) {
    throw new AppError(422, 'total_below_paid', 'O novo total fica abaixo do valor já pago. Estorne um pagamento antes.');
  }
  await tx
    .update(orders)
    .set({
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      totalCents: totals.totalCents,
      updatedAt: now(),
    })
    .where(eq(orders.id, orderId));
  return totals;
}

async function insertItems(tx: Tx, orderId: string, items: ResolvedItem[], actor: Actor | null, startSort: number) {
  const ids: string[] = [];
  let sort = startSort;
  for (const it of items) {
    const [row] = await tx
      .insert(orderItems)
      .values({
        orderId,
        productId: it.productId,
        variantId: it.variantId,
        productName: it.productName,
        variantName: it.variantName,
        categoryName: it.categoryName,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        optionsUnitCents: it.optionsUnitCents,
        totalCents: it.totalCents,
        unitCostCents: it.unitCostCents,
        sendToKitchen: it.sendToKitchen,
        notes: it.notes,
        comboComponents: it.comboComponents,
        createdBy: actor?.userId ?? null,
        createdAt: now(),
        sort: sort++,
      })
      .returning({ id: orderItems.id });
    ids.push(row!.id);
    for (const o of it.options) {
      await tx.insert(orderItemOptions).values({
        orderItemId: row!.id,
        optionId: o.optionId,
        groupName: o.groupName,
        optionName: o.optionName,
        priceCents: o.priceCents,
        costCents: o.costCents,
        quantity: o.quantity,
      });
    }
  }
  return ids;
}

function itemSummary(items: { productName: string; variantName: string | null; quantity: number }[]) {
  return items.map((i) => `${i.quantity}x ${i.productName}${i.variantName ? ' ' + i.variantName : ''}`).join(', ');
}

/**
 * Lança itens ainda não enviados: cria um novo ticket de cozinha (rodada) com os itens de
 * produção e baixa o estoque pela ficha técnica (uma única vez por item).
 */
async function launchPending(tx: Tx, order: OrderRow, actor: Actor | null, emit: Emit) {
  const pending = await tx
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orderId, order.id), eq(orderItems.status, 'active'), isNull(orderItems.sentAt)));
  if (!pending.length) return null;
  const at = now();
  let ticketId: string | null = null;
  const kitchenItems = pending.filter((i) => i.sendToKitchen);
  if (kitchenItems.length) {
    const [r] = await tx
      .select({ max: sql<number>`coalesce(max(${kitchenTickets.round}), 0)::int` })
      .from(kitchenTickets)
      .where(eq(kitchenTickets.orderId, order.id));
    const [t] = await tx
      .insert(kitchenTickets)
      .values({ orderId: order.id, round: (r?.max ?? 0) + 1, createdAt: at })
      .returning();
    ticketId = t!.id;
    emit({ type: 'kitchen.changed', orderId: order.id });
  }
  for (const it of pending) {
    if (!it.stockDeducted) await deductForItem(tx, it, actor?.userId ?? null);
    await tx
      .update(orderItems)
      .set({ sentAt: at, stockDeducted: true, ticketId: it.sendToKitchen ? ticketId : null })
      .where(eq(orderItems.id, it.id));
  }
  await orderEvent(tx, order.id, 'items.sent', actor, { items: itemSummary(pending), ticketId });
  emit({ type: 'stock.changed' });
  await refreshStage(tx, order.id, emit);
  return ticketId;
}

/** Recalcula a etapa do pedido a partir dos tickets com itens ativos. */
export async function refreshStage(tx: Tx, orderId: string, emit: Emit) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!o || o.status === 'cancelled' || o.status === 'pending') return;
  if (o.stage === 'out_for_delivery' || (o.stage === 'delivered' && o.type === 'delivery')) return;
  const rows = await tx
    .select({ status: kitchenTickets.status })
    .from(kitchenTickets)
    .where(
      and(
        eq(kitchenTickets.orderId, orderId),
        sql`exists (select 1 from ${orderItems} oi where oi.ticket_id = ${kitchenTickets.id} and oi.status = 'active')`,
      ),
    );
  const stage = stageFromTickets(rows.map((r) => r.status as KitchenStatus));
  if (o.stage === 'delivered' && stage === 'ready') return; // já entregue ao cliente (balcão/mesa)
  if (stage === o.stage) return;
  const set: Partial<OrderRow> = { stage, updatedAt: now() };
  if (stage === 'ready' && !o.readyAt) set.readyAt = now();
  await tx.update(orders).set(set).where(eq(orders.id, orderId));
  await orderEvent(tx, orderId, 'stage', null, { from: o.stage, to: stage });
  if (stage === 'ready' && o.type === 'takeout') {
    await enqueueOrderNotification(tx, orderId, 'order_ready', emit);
  }
  emit({ type: 'order.changed', orderId, number: o.number });
}

async function upsertCustomer(tx: Tx, input: CustomerInput | null | undefined, address: AddressInput | null | undefined, nbName: string | null) {
  const name = input?.name?.trim().slice(0, 120) || null;
  const phone = input?.phone ? normalizePhoneBR(input.phone) : null;
  if (input?.phone && !phone) throw badRequest('Telefone inválido');
  if (!phone) return { customerId: null, name, phone: null };
  const [existing] = await tx.select().from(customers).where(eq(customers.phone, phone));
  let customerId: string;
  if (existing) {
    customerId = existing.id;
    if (name && name !== existing.name) await tx.update(customers).set({ name, updatedAt: now() }).where(eq(customers.id, existing.id));
  } else {
    const [c] = await tx.insert(customers).values({ name: name ?? 'Cliente', phone }).returning();
    customerId = c!.id;
  }
  if (address && nbName) {
    const [same] = await tx
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.customerId, customerId),
          eq(customerAddresses.street, address.street.trim()),
          eq(customerAddresses.number, address.number.trim()),
        ),
      );
    const vals = {
      street: address.street.trim(),
      number: address.number.trim(),
      complement: address.complement?.trim() || null,
      reference: address.reference?.trim() || null,
      neighborhoodId: address.neighborhoodId,
      neighborhoodName: nbName,
      lastUsedAt: now(),
    };
    if (same) await tx.update(customerAddresses).set(vals).where(eq(customerAddresses.id, same.id));
    else await tx.insert(customerAddresses).values({ ...vals, customerId });
  }
  return { customerId, name: name ?? existing?.name ?? null, phone };
}

function validateAddress(a: AddressInput | null | undefined): AddressInput {
  if (!a || !a.street?.trim() || !a.number?.trim() || !a.neighborhoodId) {
    throw unprocessable('Endereço de entrega incompleto (rua, número e bairro)');
  }
  return a;
}

async function resolveNeighborhood(tx: DbOrTx, id: string) {
  const [nb] = await tx.select().from(neighborhoods).where(eq(neighborhoods.id, id));
  if (!nb || !nb.active) throw unprocessable('Bairro não atendido');
  return nb;
}

/** Verifica permissão de desconto: caixa até o limite configurado; acima disso, gerente. */
async function authorizeDiscount(ctx: Ctx, subtotal: number, discountCents: number, supervisor?: SupervisorInput | null) {
  if (discountCents <= 0) return null;
  const s = await getSettings(ctx.db);
  const bp = effectiveDiscountBp(subtotal, discountCents);
  if (can(ctx.actor.role, 'orders.discount.unlimited')) return null;
  if (can(ctx.actor.role, 'orders.discount') && bp <= s.cashierMaxDiscountBp) return null;
  return authorize(ctx.db, ctx.actor, 'orders.discount.unlimited', supervisor);
}

function validateDiscount(d: DiscountSpec | null | undefined) {
  if (!d) return null;
  if (!d.reason?.trim()) throw unprocessable('Informe o motivo do desconto');
  if (d.type === 'percent' && (!Number.isInteger(d.value) || d.value <= 0 || d.value > 10000)) throw unprocessable('Percentual inválido');
  if (d.type === 'amount' && (!Number.isSafeInteger(d.value) || d.value <= 0)) throw unprocessable('Valor de desconto inválido');
  return d;
}

function itemsSignature(items: ItemInput[]) {
  return items
    .map((i) => `${i.variantId}x${i.quantity}`)
    .sort()
    .join('|');
}

// ---------------- criação ----------------

export async function createOrder(
  ctx: Ctx,
  input: CreateOrderInput,
  opts: { idem?: IdemKey; supervisor?: SupervisorInput | null } = {},
) {
  const source = input.source ?? 'pos';
  if (source === 'pos') requirePerm(ctx.actor, 'orders.create');
  const discount = validateDiscount(input.discount);
  if (input.deliveryFeeCents != null && source === 'pos') {
    if (!Number.isSafeInteger(input.deliveryFeeCents) || input.deliveryFeeCents < 0) throw badRequest('Taxa de entrega inválida');
  }
  // precificação e autorização fora da transação (o login do supervisor tem contagem própria de falhas)
  const preview = await resolveItems(ctx.db, input.items, { online: source === 'online' });
  const previewSubtotal = preview.reduce((a, i) => a + i.totalCents, 0);
  const previewDiscount = discount ? computeOrderTotals({ items: [{ unitPriceCents: previewSubtotal, quantity: 1, options: [] }], discount, deliveryFeeCents: 0 }).discountCents : 0;
  let authorizedBy = await authorizeDiscount(ctx, previewSubtotal, previewDiscount, opts.supervisor);
  let feeOverride = false;
  if (input.type === 'delivery' && input.deliveryFeeCents != null && source === 'pos') {
    const nb = await resolveNeighborhood(ctx.db, validateAddress(input.address).neighborhoodId);
    if (nb.feeCents !== input.deliveryFeeCents) {
      feeOverride = true;
      authorizedBy = (await authorize(ctx.db, ctx.actor, 'orders.delivery_fee_override', opts.supervisor)) ?? authorizedBy;
    }
  }

  return inTx(ctx, async (tx, emit) => {
    const res = await idempotent(tx, opts.idem, async () => {
      const day = await requireOpenDay(tx);
      const settings = await getSettings(tx);
      const items = await resolveItems(tx, input.items, { online: source === 'online' });

      let tableLabel: string | null = null;
      if (input.type === 'table') {
        tableLabel = input.tableLabel?.trim().slice(0, 20) || null;
        if (!tableLabel) throw unprocessable('Informe a mesa');
        const [busy] = await tx
          .select({ id: orders.id, number: orders.number })
          .from(orders)
          .where(and(eq(orders.businessDayId, day.id), eq(orders.tableLabel, tableLabel), inArray(orders.status, ['open', 'pending'])));
        if (busy) throw new AppError(409, 'table_busy', `A mesa ${tableLabel} já tem comanda aberta (#${busy.number})`, busy);
      }

      let nb: typeof neighborhoods.$inferSelect | null = null;
      let address: AddressInput | null = null;
      if (input.type === 'delivery') {
        address = validateAddress(input.address);
        nb = await resolveNeighborhood(tx, address.neighborhoodId);
        if (!input.customer?.name?.trim() || !input.customer?.phone) throw unprocessable('Delivery exige nome e telefone do cliente');
      }
      if (source !== 'pos' && (!input.customer?.name?.trim() || !input.customer?.phone)) {
        throw unprocessable('Informe nome e telefone');
      }
      const cust = await upsertCustomer(tx, input.customer, address, nb?.name ?? null);

      const deliveryFeeCents = input.type === 'delivery' ? (feeOverride ? input.deliveryFeeCents! : nb!.feeCents) : 0;
      const totals = computeOrderTotals({
        items: items.map((i) => ({ unitPriceCents: i.unitPriceCents, quantity: i.quantity, options: i.options })),
        discount: discount ? { type: discount.type, value: discount.value } : null,
        deliveryFeeCents,
      });

      if (source === 'online') {
        const minOrder = Math.max(settings.onlineMinOrderCents, nb?.minOrderCents ?? 0);
        if (totals.subtotalCents < minOrder) {
          throw new AppError(422, 'below_minimum', 'Pedido abaixo do valor mínimo', { minOrderCents: minOrder });
        }
      }

      // alerta de possível duplicidade (não bloqueia: o operador pode confirmar)
      if (!input.confirmDuplicate && (cust.phone || tableLabel)) {
        const since = new Date(now().getTime() - settings.duplicateWindowMinutes * 60000);
        const recent = await tx
          .select({ id: orders.id, number: orders.number })
          .from(orders)
          .where(
            and(
              eq(orders.businessDayId, day.id),
              ne(orders.status, 'cancelled'),
              gte(orders.createdAt, since),
              cust.phone ? eq(orders.customerPhone, cust.phone) : eq(orders.tableLabel, tableLabel!),
            ),
          );
        const sig = itemsSignature(input.items);
        for (const r of recent) {
          const its = await tx
            .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
            .from(orderItems)
            .where(and(eq(orderItems.orderId, r.id), eq(orderItems.status, 'active')));
          if (itemsSignature(its.map((x) => ({ variantId: x.variantId!, quantity: x.quantity }))) === sig) {
            throw new AppError(409, 'possible_duplicate', `Pedido parecido registrado há pouco (#${r.number}). Confirme se é um novo pedido.`, r);
          }
        }
      }

      const number = await nextOrderNumber(tx, day.id);
      const at = now();
      const etaMinutes =
        input.etaMinutes ?? (input.type === 'delivery' ? (nb?.etaMinutes ?? settings.deliveryEtaMinutes) : input.type === 'takeout' ? settings.pickupEtaMinutes : null);
      const status = source === 'pos' ? 'open' : 'pending';
      const [order] = await tx
        .insert(orders)
        .values({
          businessDayId: day.id,
          number,
          type: input.type,
          source,
          status,
          stage: 'received',
          tableLabel,
          customerId: cust.customerId,
          customerName: cust.name,
          customerPhone: cust.phone,
          addrStreet: address?.street.trim() ?? null,
          addrNumber: address?.number.trim() ?? null,
          addrComplement: address?.complement?.trim() || null,
          addrReference: address?.reference?.trim() || null,
          neighborhoodId: nb?.id ?? null,
          neighborhoodName: nb?.name ?? null,
          notes: input.notes?.trim().slice(0, 500) || null,
          subtotalCents: totals.subtotalCents,
          discountType: discount?.type ?? null,
          discountValue: discount?.value ?? null,
          discountCents: totals.discountCents,
          discountReason: discount?.reason.trim() ?? null,
          discountBy: discount ? (authorizedBy ?? ctx.actor.userId) : null,
          deliveryFeeCents,
          totalCents: totals.totalCents,
          paymentIntent: input.paymentIntent ?? null,
          changeForCents: input.changeForCents ?? null,
          etaAt: etaMinutes ? new Date(at.getTime() + etaMinutes * 60000) : null,
          trackingToken: randomToken(18),
          waOptIn: !!input.waOptIn && !!cust.phone,
          deliveryStatus: input.type === 'delivery' ? 'waiting' : null,
          createdBy: source === 'pos' ? ctx.actor.userId : null,
          createdAt: at,
          updatedAt: at,
          acceptedAt: status === 'open' ? at : null,
        })
        .returning();
      await insertItems(tx, order!.id, items, source === 'pos' ? ctx.actor : null, 0);
      await recalc(tx, order!.id);
      await orderEvent(
        tx,
        order!.id,
        'created',
        source === 'pos' ? ctx.actor : null,
        {
          source,
          type: input.type,
          items: itemSummary(items),
          totalCents: totals.totalCents,
          discount: discount ? { ...discount, cents: totals.discountCents } : null,
          deliveryFeeOverride: feeOverride || undefined,
          duplicateConfirmed: input.confirmDuplicate || undefined,
        },
        authorizedBy,
      );
      if (status === 'open' && input.send !== false) await launchPending(tx, order!, ctx.actor, emit);
      if (source !== 'pos') await enqueueOrderNotification(tx, order!.id, 'order_received', emit);
      emit({ type: 'order.changed', orderId: order!.id, number });
      return { id: order!.id, number, trackingToken: order!.trackingToken };
    });
    return res.value;
  });
}

// ---------------- edição ----------------

export interface HeaderPatch {
  type?: OrderType;
  tableLabel?: string | null;
  customer?: CustomerInput | null;
  address?: AddressInput | null;
  notes?: string | null;
  etaMinutes?: number | null;
  deliveryFeeCents?: number | null;
}

export async function updateHeader(ctx: Ctx, orderId: string, version: number, patch: HeaderPatch, supervisor?: SupervisorInput | null) {
  requirePerm(ctx.actor, 'orders.edit');
  let authorizedBy: string | null = null;
  if (patch.deliveryFeeCents != null) authorizedBy = await authorize(ctx.db, ctx.actor, 'orders.delivery_fee_override', supervisor);
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    checkVersion(o, version);
    requireEditable(o);
    const type = patch.type ?? o.type;
    if (o.deliveryStatus && o.deliveryStatus !== 'waiting' && type !== 'delivery') throw conflict('Entrega já saiu; não é possível mudar o tipo');
    const set: Partial<OrderRow> = { type };
    const changes: Record<string, unknown> = {};
    if (patch.type && patch.type !== o.type) changes.type = { from: o.type, to: patch.type };
    if (type === 'table') {
      const label = (patch.tableLabel ?? o.tableLabel)?.trim();
      if (!label) throw unprocessable('Informe a mesa');
      if (label !== o.tableLabel) {
        const [busy] = await tx
          .select({ id: orders.id, number: orders.number })
          .from(orders)
          .where(and(eq(orders.businessDayId, o.businessDayId), eq(orders.tableLabel, label), inArray(orders.status, ['open', 'pending']), ne(orders.id, o.id)));
        if (busy) throw new AppError(409, 'table_busy', `A mesa ${label} já tem comanda aberta (#${busy.number})`, busy);
        changes.table = { from: o.tableLabel, to: label };
      }
      set.tableLabel = label;
    } else set.tableLabel = null;

    if (patch.customer !== undefined || patch.address !== undefined || patch.type) {
      let nb: typeof neighborhoods.$inferSelect | null = null;
      let address: AddressInput | null = null;
      if (type === 'delivery') {
        address = validateAddress(
          patch.address ?? (o.addrStreet ? { street: o.addrStreet, number: o.addrNumber!, complement: o.addrComplement, reference: o.addrReference, neighborhoodId: o.neighborhoodId! } : null),
        );
        nb = await resolveNeighborhood(tx, address.neighborhoodId);
      }
      const custIn = patch.customer ?? { name: o.customerName, phone: o.customerPhone };
      if (type === 'delivery' && (!custIn.name?.trim() || !custIn.phone)) throw unprocessable('Delivery exige nome e telefone do cliente');
      const cust = await upsertCustomer(tx, custIn, address, nb?.name ?? null);
      Object.assign(set, {
        customerId: cust.customerId,
        customerName: cust.name,
        customerPhone: cust.phone,
        addrStreet: address?.street.trim() ?? null,
        addrNumber: address?.number.trim() ?? null,
        addrComplement: address?.complement?.trim() || null,
        addrReference: address?.reference?.trim() || null,
        neighborhoodId: nb?.id ?? null,
        neighborhoodName: nb?.name ?? null,
      });
      if (type === 'delivery') {
        set.deliveryFeeCents = patch.deliveryFeeCents ?? (nb!.id === o.neighborhoodId && !patch.type ? o.deliveryFeeCents : nb!.feeCents);
        set.deliveryStatus = o.deliveryStatus ?? 'waiting';
      } else {
        set.deliveryFeeCents = 0;
        set.deliveryStatus = null;
      }
      changes.customer = { name: cust.name, phone: cust.phone ? '***' + cust.phone.slice(-4) : null, neighborhood: nb?.name };
    } else if (patch.deliveryFeeCents != null) {
      if (type !== 'delivery') throw unprocessable('Taxa de entrega só se aplica a delivery');
      set.deliveryFeeCents = patch.deliveryFeeCents;
    }
    if (patch.deliveryFeeCents != null) changes.deliveryFee = { from: o.deliveryFeeCents, to: patch.deliveryFeeCents };
    if (patch.notes !== undefined) {
      set.notes = patch.notes?.trim().slice(0, 500) || null;
      changes.notes = set.notes;
    }
    if (patch.etaMinutes != null) {
      if (patch.etaMinutes < 1 || patch.etaMinutes > 600) throw badRequest('Previsão inválida');
      set.etaAt = new Date(now().getTime() + patch.etaMinutes * 60000);
      changes.etaAt = set.etaAt;
    }
    await bump(tx, o.id, set);
    await recalc(tx, o.id);
    await orderEvent(tx, o.id, 'updated', ctx.actor, changes, authorizedBy);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    if (o.courierId) emit({ type: 'delivery.changed', orderId: o.id, courierId: o.courierId });
    return { id: o.id };
  });
}

export async function addItems(ctx: Ctx, orderId: string, version: number, items: ItemInput[], send = true) {
  requirePerm(ctx.actor, 'orders.edit');
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    checkVersion(o, version);
    requireEditable(o);
    if (o.deliveryStatus === 'en_route' || o.deliveryStatus === 'delivered') throw conflict('Entrega já saiu; não é possível adicionar itens');
    const resolved = await resolveItems(tx, items);
    const [r] = await tx.select({ max: sql<number>`coalesce(max(${orderItems.sort}), 0)::int` }).from(orderItems).where(eq(orderItems.orderId, o.id));
    await insertItems(tx, o.id, resolved, ctx.actor, (r?.max ?? 0) + 1);
    await bump(tx, o.id);
    await recalc(tx, o.id);
    await orderEvent(tx, o.id, 'items.added', ctx.actor, { items: itemSummary(resolved) });
    if (send && o.status === 'open') {
      if (o.stage === 'delivered') await tx.update(orders).set({ stage: 'ready' }).where(eq(orders.id, o.id));
      await launchPending(tx, o, ctx.actor, emit);
    }
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id };
  });
}

/** Envia à cozinha itens lançados sem envio (ex.: comanda montada aos poucos). */
export async function sendPending(ctx: Ctx, orderId: string, version: number) {
  requirePerm(ctx.actor, 'orders.edit');
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    checkVersion(o, version);
    if (o.status !== 'open') throw conflict('Somente pedidos em aberto podem ser enviados');
    const t = await launchPending(tx, o, ctx.actor, emit);
    await bump(tx, o.id);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id, ticketId: t };
  });
}

/** Altera quantidade/observação de item ainda NÃO enviado à cozinha. */
export async function updateItem(ctx: Ctx, orderId: string, itemId: string, version: number, patch: { quantity?: number; notes?: string | null }) {
  requirePerm(ctx.actor, 'orders.edit');
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    checkVersion(o, version);
    requireEditable(o);
    const [it] = await tx.select().from(orderItems).where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));
    if (!it || it.status !== 'active') throw notFound('Item não encontrado');
    if (it.sentAt) throw conflict('Item já enviado à cozinha: cancele o item e lance novamente');
    const set: Partial<typeof orderItems.$inferInsert> = {};
    if (patch.quantity !== undefined) {
      if (!Number.isInteger(patch.quantity) || patch.quantity < 1 || patch.quantity > 99) throw badRequest('Quantidade inválida');
      set.quantity = patch.quantity;
      set.totalCents = (it.unitPriceCents + it.optionsUnitCents) * patch.quantity;
    }
    if (patch.notes !== undefined) set.notes = patch.notes?.trim().slice(0, 300) || null;
    await tx.update(orderItems).set(set).where(eq(orderItems.id, it.id));
    await bump(tx, o.id);
    await recalc(tx, o.id);
    await orderEvent(tx, o.id, 'item.updated', ctx.actor, { item: it.productName, ...patch });
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id };
  });
}

export async function cancelItem(
  ctx: Ctx,
  orderId: string,
  itemId: string,
  version: number,
  input: { reason: string; stockMode?: 'auto' | 'return' | 'loss' },
  supervisor?: SupervisorInput | null,
) {
  requirePerm(ctx.actor, 'orders.edit');
  if (!input.reason?.trim()) throw unprocessable('Informe o motivo do cancelamento do item');
  const [pre] = await ctx.db.select().from(orderItems).where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));
  if (!pre) throw notFound('Item não encontrado');
  const authorizedBy = pre.sentAt ? await authorize(ctx.db, ctx.actor, 'orders.cancel_item_sent', supervisor) : null;
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    checkVersion(o, version);
    requireEditable(o);
    const [it] = await tx.select().from(orderItems).where(eq(orderItems.id, itemId)).for('update');
    if (!it || it.status !== 'active') throw conflict('Item já cancelado');
    await tx
      .update(orderItems)
      .set({ status: 'cancelled', cancelledAt: now(), cancelledBy: authorizedBy ?? ctx.actor.userId, cancelReason: input.reason.trim() })
      .where(eq(orderItems.id, it.id));
    let stockResult: string | null = null;
    if (it.stockDeducted) {
      let mode = input.stockMode ?? 'auto';
      if (mode === 'auto') {
        const [t] = it.ticketId ? await tx.select().from(kitchenTickets).where(eq(kitchenTickets.id, it.ticketId)) : [];
        mode = t && t.status !== 'received' ? 'loss' : 'return';
      }
      await reverseForItem(tx, it.id, mode, ctx.actor.userId, 'Cancelamento de item: ' + input.reason.trim());
      stockResult = mode;
      emit({ type: 'stock.changed' });
    }
    if (it.ticketId) {
      await tx
        .update(kitchenTickets)
        .set({ changedAt: now(), changeNote: `CANCELADO: ${it.quantity}x ${it.productName}` })
        .where(eq(kitchenTickets.id, it.ticketId));
      emit({ type: 'kitchen.changed', orderId: o.id });
    }
    await bump(tx, o.id);
    await recalc(tx, o.id);
    await orderEvent(tx, o.id, 'item.cancelled', ctx.actor, { item: `${it.quantity}x ${it.productName}`, reason: input.reason.trim(), stock: stockResult }, authorizedBy);
    await refreshStage(tx, o.id, emit);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id };
  });
}

export async function setDiscount(ctx: Ctx, orderId: string, version: number, discount: DiscountSpec | null, supervisor?: SupervisorInput | null) {
  requirePerm(ctx.actor, 'orders.edit');
  const d = validateDiscount(discount);
  const [pre] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
  if (!pre) throw notFound('Pedido não encontrado');
  let authorizedBy: string | null = null;
  if (d) {
    const cents = computeOrderTotals({ items: [{ unitPriceCents: pre.subtotalCents, quantity: 1, options: [] }], discount: d, deliveryFeeCents: 0 }).discountCents;
    authorizedBy = await authorizeDiscount(ctx, pre.subtotalCents, cents, supervisor);
    if (!can(ctx.actor.role, 'orders.discount') && !authorizedBy) authorizedBy = await authorize(ctx.db, ctx.actor, 'orders.discount', supervisor);
  }
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    checkVersion(o, version);
    requireEditable(o);
    if (o.subtotalCents !== pre.subtotalCents) throw staleVersion();
    await bump(tx, o.id, {
      discountType: d?.type ?? null,
      discountValue: d?.value ?? null,
      discountReason: d?.reason.trim() ?? null,
      discountBy: d ? (authorizedBy ?? ctx.actor.userId) : null,
    });
    const totals = await recalc(tx, o.id);
    await orderEvent(tx, o.id, d ? 'discount.set' : 'discount.removed', ctx.actor, d ? { ...d, cents: totals.discountCents } : { previousCents: o.discountCents }, authorizedBy);
    await audit(tx, ctx.actor, d ? 'order.discount' : 'order.discount_removed', 'order', o.id, { number: o.number, cents: totals.discountCents, reason: d?.reason }, authorizedBy);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id };
  });
}

// ---------------- aceite (pedidos online) ----------------

export async function acceptOrder(ctx: Ctx, orderId: string, version: number, etaMinutes?: number | null) {
  requirePerm(ctx.actor, 'orders.edit');
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    checkVersion(o, version);
    if (o.status !== 'pending') throw conflict('Este pedido não está aguardando aceite');
    const at = now();
    const set: Partial<OrderRow> = { status: 'open', acceptedAt: at };
    if (etaMinutes) set.etaAt = new Date(at.getTime() + etaMinutes * 60000);
    await bump(tx, o.id, set);
    await orderEvent(tx, o.id, 'accepted', ctx.actor, { etaMinutes });
    const fresh = await lockOrder(tx, o.id);
    await launchPending(tx, fresh, ctx.actor, emit);
    await enqueueOrderNotification(tx, o.id, 'order_accepted', emit);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id };
  });
}

// ---------------- pagamentos ----------------

export interface PaymentInput {
  method: PaymentMethod;
  amountCents: number; // valor a abater do saldo
  tenderedCents?: number | null; // dinheiro entregue pelo cliente
  payerLabel?: string | null;
  note?: string | null;
  providerRef?: string | null;
}

export async function addPayment(ctx: Ctx, orderId: string, input: PaymentInput, idem?: IdemKey) {
  requirePerm(ctx.actor, 'payments.create');
  if (input.method === 'pix_integrated') {
    throw new AppError(422, 'not_configured', 'Pix integrado não está configurado. Registre como Pix conferido manualmente após verificar o recebimento no extrato.');
  }
  return inTx(ctx, async (tx, emit) => {
    const res = await idempotent(tx, idem, async () => {
      const cash = await requireOpenCash(tx);
      const o = await lockOrder(tx, orderId);
      if (o.status === 'cancelled') throw conflict('Pedido cancelado');
      if (o.status === 'pending') throw conflict('Aceite o pedido antes de registrar pagamento');
      if (o.status === 'closed' && !o.receivable) throw conflict('Pedido já finalizado');
      const balance = o.totalCents - o.paidCents;
      if (balance <= 0) throw conflict('Pedido já está quitado');
      if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw badRequest('Valor inválido');
      let applied = input.amountCents;
      let change = 0;
      let tendered: number | null = null;
      if (input.method === 'cash') {
        tendered = input.tenderedCents ?? input.amountCents;
        if (!Number.isSafeInteger(tendered)) throw badRequest('Valor recebido inválido');
        try {
          const r = cashPayment(balance, tendered, Math.min(input.amountCents, balance));
          applied = r.appliedCents;
          change = r.changeCents;
        } catch (e) {
          throw unprocessable((e as Error).message);
        }
        if (input.amountCents > balance) throw unprocessable('Valor maior que o saldo do pedido');
      } else if (applied > balance) {
        throw unprocessable('Valor maior que o saldo do pedido (troco só existe em dinheiro)');
      }
      const at = now();
      const [p] = await tx
        .insert(payments)
        .values({
          orderId: o.id,
          method: input.method,
          amountCents: applied,
          tenderedCents: tendered,
          changeCents: change,
          payerLabel: input.payerLabel?.trim().slice(0, 60) || null,
          note: input.note?.trim().slice(0, 200) || null,
          providerRef: input.providerRef ?? null,
          cashSessionId: cash.id,
          createdBy: ctx.actor.userId,
          createdAt: at,
        })
        .returning();
      await tx.insert(cashMovements).values({
        cashSessionId: cash.id,
        type: 'payment',
        method: input.method,
        amountCents: applied,
        paymentId: p!.id,
        orderId: o.id,
        reason: `Pedido #${o.number}`,
        createdBy: ctx.actor.userId,
        createdAt: at,
      });
      await tx
        .update(orders)
        .set({ paidCents: sql`${orders.paidCents} + ${applied}`, updatedAt: at })
        .where(eq(orders.id, o.id));
      await orderEvent(tx, o.id, 'payment', ctx.actor, { method: input.method, amountCents: applied, tenderedCents: tendered, changeCents: change, payer: p!.payerLabel });
      emit({ type: 'order.changed', orderId: o.id, number: o.number });
      emit({ type: 'cash.changed' });
      return { paymentId: p!.id, appliedCents: applied, changeCents: change, balanceCents: balance - applied };
    });
    return res.value;
  });
}

async function refundInTx(tx: Tx, ctx: Ctx, p: typeof payments.$inferSelect, reason: string, authorizedBy: string | null) {
  const cash = await requireOpenCash(tx);
  const at = now();
  const upd = await tx
    .update(payments)
    .set({ status: 'refunded', refundedAt: at, refundedBy: ctx.actor.userId, refundReason: reason, refundCashSessionId: cash.id })
    .where(and(eq(payments.id, p.id), eq(payments.status, 'confirmed')))
    .returning({ id: payments.id });
  if (!upd.length) throw conflict('Pagamento já estornado');
  await tx.insert(cashMovements).values({
    cashSessionId: cash.id,
    type: 'refund',
    method: p.method,
    amountCents: -p.amountCents,
    paymentId: p.id,
    orderId: p.orderId,
    reason,
    createdBy: ctx.actor.userId,
    authorizedBy,
    createdAt: at,
  });
  await tx
    .update(orders)
    .set({ paidCents: sql`${orders.paidCents} - ${p.amountCents}`, updatedAt: at })
    .where(eq(orders.id, p.orderId));
}

export async function refundPayment(ctx: Ctx, paymentId: string, reason: string, supervisor?: SupervisorInput | null) {
  requirePerm(ctx.actor, 'payments.create');
  if (!reason?.trim()) throw unprocessable('Informe o motivo do estorno');
  const authorizedBy = await authorize(ctx.db, ctx.actor, 'payments.refund', supervisor);
  return inTx(ctx, async (tx, emit) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) throw notFound('Pagamento não encontrado');
    const o = await lockOrder(tx, p.orderId);
    if (o.status === 'closed') throw conflict('Reabra o pedido antes de estornar');
    await refundInTx(tx, ctx, p, reason.trim(), authorizedBy);
    await orderEvent(tx, o.id, 'payment.refunded', ctx.actor, { method: p.method, amountCents: p.amountCents, reason }, authorizedBy);
    await audit(tx, ctx.actor, 'payment.refund', 'payment', p.id, { orderNumber: o.number, amountCents: p.amountCents, reason }, authorizedBy);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    emit({ type: 'cash.changed' });
    return { id: o.id };
  });
}

/** Sugestão de divisão de conta em partes iguais sobre o saldo restante. */
export async function splitSuggestion(db: DbOrTx, orderId: string, ways: number) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) throw notFound();
  const balance = o.totalCents - o.paidCents;
  if (balance <= 0) return { balanceCents: 0, parts: [] };
  return { balanceCents: balance, parts: splitEvenly(balance, ways) };
}

// ---------------- cancelamento, fechamento, reabertura ----------------

export async function cancelOrder(
  ctx: Ctx,
  orderId: string,
  version: number,
  input: { reason: string; refundPayments?: boolean; stockMode?: 'auto' | 'return' | 'loss' },
  supervisor?: SupervisorInput | null,
) {
  if (!input.reason?.trim() || input.reason.trim().length < 3) throw unprocessable('Informe o motivo do cancelamento');
  const [pre] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
  if (!pre) throw notFound('Pedido não encontrado');
  // recusar pedido online ainda não aceito é operação do caixa; cancelar pedido aceito exige permissão
  const authorizedBy = pre.status === 'pending' ? (requirePerm(ctx.actor, 'orders.edit'), null) : await authorize(ctx.db, ctx.actor, 'orders.cancel', supervisor);
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    checkVersion(o, version);
    if (o.status === 'cancelled') throw conflict('Pedido já cancelado');
    if (o.status === 'closed') throw conflict('Reabra o pedido antes de cancelar');
    if (o.deliveryStatus === 'en_route') throw conflict('Pedido está em rota. Registre a ocorrência e o retorno antes de cancelar.');
    const reason = input.reason.trim();
    const confirmed = await tx.select().from(payments).where(and(eq(payments.orderId, o.id), eq(payments.status, 'confirmed')));
    if (confirmed.length) {
      if (!input.refundPayments) {
        throw new AppError(409, 'payments_exist', 'Este pedido tem pagamentos. Confirme o estorno para cancelar.', {
          paidCents: o.paidCents,
          payments: confirmed.map((p) => ({ method: p.method, amountCents: p.amountCents })),
        });
      }
      if (!can(ctx.actor.role, 'payments.refund') && !authorizedBy) await authorize(ctx.db, ctx.actor, 'payments.refund', supervisor);
      for (const p of confirmed) await refundInTx(tx, ctx, p, 'Cancelamento do pedido: ' + reason, authorizedBy);
      emit({ type: 'cash.changed' });
    }
    const items = await tx.select().from(orderItems).where(and(eq(orderItems.orderId, o.id), eq(orderItems.status, 'active')));
    const tickets = await tx.select().from(kitchenTickets).where(eq(kitchenTickets.orderId, o.id));
    const stockLog: Record<string, string> = {};
    for (const it of items) {
      if (!it.stockDeducted) continue;
      let mode = input.stockMode ?? 'auto';
      if (mode === 'auto') {
        const t = tickets.find((x) => x.id === it.ticketId);
        mode = t && t.status !== 'received' ? 'loss' : 'return';
      }
      await reverseForItem(tx, it.id, mode, ctx.actor.userId, 'Cancelamento do pedido: ' + reason);
      stockLog[`${it.quantity}x ${it.productName}`] = mode;
    }
    const at = now();
    await bump(tx, o.id, {
      status: 'cancelled',
      cancelledAt: at,
      cancelledBy: ctx.actor.userId,
      cancelReason: reason,
      deliveryRunId: null,
      deliveryStatus: o.deliveryStatus ? 'waiting' : null,
      courierId: null,
    });
    if (tickets.length) {
      await tx.update(kitchenTickets).set({ changedAt: at, changeNote: 'PEDIDO CANCELADO' }).where(eq(kitchenTickets.orderId, o.id));
      emit({ type: 'kitchen.changed', orderId: o.id });
    }
    await orderEvent(tx, o.id, 'cancelled', ctx.actor, { reason, refunded: confirmed.length, stock: stockLog, previousStatus: o.status }, authorizedBy);
    await audit(tx, ctx.actor, 'order.cancel', 'order', o.id, { number: o.number, totalCents: o.totalCents, reason }, authorizedBy);
    await enqueueOrderNotification(tx, o.id, 'order_cancelled', emit);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    emit({ type: 'stock.changed' });
    if (o.courierId) emit({ type: 'delivery.changed', orderId: o.id, courierId: o.courierId });
    return { id: o.id };
  });
}

/** Entrega ao cliente no balcão/mesa/retirada. */
export async function markHandedOver(ctx: Ctx, orderId: string) {
  requirePerm(ctx.actor, 'orders.edit');
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    if (o.type === 'delivery') throw conflict('Use o painel de entregas para pedidos de delivery');
    if (o.status !== 'open' && o.status !== 'closed') throw conflict('Pedido não está em aberto');
    if (o.stage !== 'ready') throw conflict('O pedido ainda não está pronto');
    await tx.update(orders).set({ stage: 'delivered', deliveredAt: now(), updatedAt: now() }).where(eq(orders.id, o.id));
    await orderEvent(tx, o.id, 'handed_over', ctx.actor);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id };
  });
}

export async function closeOrder(ctx: Ctx, orderId: string, version: number, input: { receivable?: boolean } = {}, supervisor?: SupervisorInput | null) {
  requirePerm(ctx.actor, 'orders.edit');
  const authorizedBy = input.receivable ? await authorize(ctx.db, ctx.actor, 'orders.close_receivable', supervisor) : null;
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    checkVersion(o, version);
    if (o.status !== 'open') throw conflict('Somente pedidos em aberto podem ser finalizados');
    await recalc(tx, o.id);
    const [fresh] = await tx.select().from(orders).where(eq(orders.id, o.id));
    const balance = fresh!.totalCents - fresh!.paidCents;
    if (balance > 0 && !input.receivable) {
      throw new AppError(422, 'balance_due', 'Ainda há saldo a receber neste pedido', { balanceCents: balance });
    }
    const [unsent] = await tx
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, o.id), eq(orderItems.status, 'active'), isNull(orderItems.sentAt)));
    if (unsent) throw conflict('Há itens lançados que ainda não foram enviados');
    const [active] = await tx.select({ c: sql<number>`count(*)::int` }).from(orderItems).where(and(eq(orderItems.orderId, o.id), eq(orderItems.status, 'active')));
    if (!active?.c) throw conflict('Pedido sem itens ativos. Cancele o pedido em vez de finalizar.');
    if (o.type === 'delivery') {
      if (o.deliveryStatus !== 'delivered') throw conflict('Delivery só pode ser finalizado após a entrega');
    } else if (o.stage !== 'ready' && o.stage !== 'delivered') {
      throw conflict('O pedido ainda está em produção');
    }
    const at = now();
    await bump(tx, o.id, {
      status: 'closed',
      closedAt: at,
      closedBy: ctx.actor.userId,
      receivable: balance > 0,
      stage: 'delivered',
      deliveredAt: o.deliveredAt ?? at,
    });
    await orderEvent(tx, o.id, 'closed', ctx.actor, { totalCents: fresh!.totalCents, paidCents: fresh!.paidCents, receivableCents: balance > 0 ? balance : undefined }, authorizedBy);
    if (balance > 0) await audit(tx, ctx.actor, 'order.close_receivable', 'order', o.id, { number: o.number, balance }, authorizedBy);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id };
  });
}

export async function reopenOrder(ctx: Ctx, orderId: string, reason: string, supervisor?: SupervisorInput | null) {
  if (!reason?.trim()) throw unprocessable('Informe o motivo da reabertura');
  const authorizedBy = await authorize(ctx.db, ctx.actor, 'orders.reopen', supervisor);
  return inTx(ctx, async (tx, emit) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== 'closed') throw conflict('Somente pedidos finalizados podem ser reabertos');
    const [day] = await tx.select().from(businessDays).where(eq(businessDays.id, o.businessDayId));
    if (day?.status !== 'open') throw conflict('O dia operacional deste pedido já foi fechado; a reabertura não é permitida');
    if (o.courierSettlementId) throw conflict('A entrega deste pedido já foi acertada com o entregador');
    await bump(tx, o.id, { status: 'open', closedAt: null, closedBy: null, receivable: false });
    await orderEvent(tx, o.id, 'reopened', ctx.actor, { reason: reason.trim() }, authorizedBy);
    await audit(tx, ctx.actor, 'order.reopen', 'order', o.id, { number: o.number, reason: reason.trim() }, authorizedBy);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id };
  });
}

// ---------------- consultas ----------------

export async function getOrder(db: DbOrTx, orderId: string) {
  const [o] = await db
    .select({ order: orders, courierName: couriers.name, createdByName: users.name })
    .from(orders)
    .leftJoin(couriers, eq(couriers.id, orders.courierId))
    .leftJoin(users, eq(users.id, orders.createdBy))
    .where(eq(orders.id, orderId));
  if (!o) throw notFound('Pedido não encontrado');
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.sort), asc(orderItems.createdAt));
  const opts = items.length ? await db.select().from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, items.map((i) => i.id))) : [];
  const pays = await db
    .select({ p: payments, userName: users.name })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.createdBy))
    .where(eq(payments.orderId, orderId))
    .orderBy(asc(payments.createdAt));
  const tickets = await db.select().from(kitchenTickets).where(eq(kitchenTickets.orderId, orderId)).orderBy(asc(kitchenTickets.round));
  const authUsers = sql`(select name from users u2 where u2.id = ${orderEvents.authorizedBy})`;
  const events = await db
    .select({
      id: orderEvents.id,
      type: orderEvents.type,
      data: orderEvents.data,
      createdAt: orderEvents.createdAt,
      userName: users.name,
      authorizedByName: sql<string | null>`${authUsers}`,
    })
    .from(orderEvents)
    .leftJoin(users, eq(users.id, orderEvents.userId))
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.id));
  return {
    ...o.order,
    courierName: o.courierName,
    createdByName: o.createdByName,
    balanceCents: o.order.totalCents - o.order.paidCents,
    items: items.map((i) => ({ ...i, options: opts.filter((x) => x.orderItemId === i.id) })),
    payments: pays.map((p) => ({ ...p.p, userName: p.userName })),
    tickets,
    events,
  };
}

export type OrderView = Awaited<ReturnType<typeof getOrder>>;

export interface OrderFilters {
  businessDayId?: string;
  status?: ('pending' | 'open' | 'closed' | 'cancelled')[];
  type?: OrderType;
  q?: string;
  receivable?: boolean;
  limit?: number;
}

/** Busca por número, cliente, telefone ou endereço. Sem dia informado, usa o dia aberto (ou todos se q for telefone/nome). */
export async function listOrders(db: DbOrTx, f: OrderFilters) {
  const conds: SQL[] = [];
  if (f.businessDayId) conds.push(eq(orders.businessDayId, f.businessDayId));
  if (f.status?.length) conds.push(inArray(orders.status, f.status));
  if (f.type) conds.push(eq(orders.type, f.type));
  if (f.receivable) conds.push(and(eq(orders.receivable, true), sql`${orders.totalCents} > ${orders.paidCents}`)!);
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    const ors: SQL[] = [ilike(orders.customerName, like), ilike(orders.addrStreet, like), ilike(orders.neighborhoodName, like), ilike(orders.tableLabel, like)];
    if (/^\d{1,5}$/.test(q)) ors.push(eq(orders.number, Number(q)));
    if (digits.length >= 4) ors.push(ilike(orders.customerPhone, `%${digits}%`));
    conds.push(or(...ors)!);
  }
  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      businessDayId: orders.businessDayId,
      type: orders.type,
      source: orders.source,
      status: orders.status,
      stage: orders.stage,
      tableLabel: orders.tableLabel,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      addrStreet: orders.addrStreet,
      addrNumber: orders.addrNumber,
      neighborhoodName: orders.neighborhoodName,
      totalCents: orders.totalCents,
      paidCents: orders.paidCents,
      receivable: orders.receivable,
      deliveryStatus: orders.deliveryStatus,
      courierName: couriers.name,
      createdAt: orders.createdAt,
      etaAt: orders.etaAt,
      version: orders.version,
      referenceDate: businessDays.referenceDate,
    })
    .from(orders)
    .innerJoin(businessDays, eq(businessDays.id, orders.businessDayId))
    .leftJoin(couriers, eq(couriers.id, orders.courierId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(Math.min(f.limit ?? 200, 500));
  return rows;
}
