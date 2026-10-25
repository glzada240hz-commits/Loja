import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { can, canTransitionDelivery, normalizePhoneBR, type DeliveryStatus } from '@guto/core';
import type { DbOrTx, Tx } from '../db/index.js';
import {
  cashMovements,
  courierAdjustments,
  couriers,
  courierSettlements,
  deliveryRuns,
  neighborhoods,
  orderItems,
  orders,
} from '../db/schema.js';
import { audit, orderEvent } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { idempotent, type IdemKey } from '../lib/idempotency.js';
import { enqueueOrderNotification } from '../whatsapp/notify.js';
import { requireOpenDay } from './businessDay.js';
import { cashBalance, requireOpenCash } from './cash.js';

export async function listCouriers(db: DbOrTx, includeInactive = false) {
  const q = db.select().from(couriers).orderBy(asc(couriers.name));
  return includeInactive ? q : q.where(eq(couriers.active, true));
}

export async function saveCourier(
  ctx: Ctx,
  input: { id?: string; name: string; phone?: string | null; userId?: string | null; defaultFeeCents: number; active?: boolean; notes?: string | null },
) {
  requirePerm(ctx.actor, 'settings.manage');
  if (!input.name?.trim()) throw badRequest('Informe o nome');
  if (!Number.isSafeInteger(input.defaultFeeCents) || input.defaultFeeCents < 0) throw badRequest('Repasse inválido');
  const phone = input.phone ? normalizePhoneBR(input.phone) : null;
  const vals = { name: input.name.trim(), phone, userId: input.userId || null, defaultFeeCents: input.defaultFeeCents, active: input.active ?? true, notes: input.notes ?? null };
  return inTx(ctx, async (tx) => {
    const [row] = input.id ? await tx.update(couriers).set(vals).where(eq(couriers.id, input.id)).returning() : await tx.insert(couriers).values(vals).returning();
    if (!row) throw notFound();
    await audit(tx, ctx.actor, 'courier.save', 'courier', row.id, { name: vals.name, defaultFeeCents: vals.defaultFeeCents });
    return row;
  });
}

const boardFields = {
  id: orders.id,
  number: orders.number,
  status: orders.status,
  stage: orders.stage,
  customerName: orders.customerName,
  customerPhone: orders.customerPhone,
  addrStreet: orders.addrStreet,
  addrNumber: orders.addrNumber,
  addrComplement: orders.addrComplement,
  addrReference: orders.addrReference,
  neighborhoodName: orders.neighborhoodName,
  totalCents: orders.totalCents,
  paidCents: orders.paidCents,
  deliveryFeeCents: orders.deliveryFeeCents,
  courierFeeCents: orders.courierFeeCents,
  paymentIntent: orders.paymentIntent,
  changeForCents: orders.changeForCents,
  deliveryStatus: orders.deliveryStatus,
  deliveryIssue: orders.deliveryIssue,
  courierId: orders.courierId,
  courierName: couriers.name,
  deliveryRunId: orders.deliveryRunId,
  createdAt: orders.createdAt,
  readyAt: orders.readyAt,
  dispatchedAt: orders.dispatchedAt,
  deliveredAt: orders.deliveredAt,
  etaAt: orders.etaAt,
  version: orders.version,
  notes: orders.notes,
};

/** Painel de expedição: entregas do dia operacional aberto. */
export async function deliveryBoard(ctx: Ctx) {
  requirePerm(ctx.actor, 'deliveries.manage');
  const day = await requireOpenDay(ctx.db);
  const rows = await ctx.db
    .select(boardFields)
    .from(orders)
    .leftJoin(couriers, eq(couriers.id, orders.courierId))
    .where(and(eq(orders.businessDayId, day.id), eq(orders.type, 'delivery'), ne(orders.status, 'cancelled'), ne(orders.status, 'pending')))
    .orderBy(asc(orders.createdAt));
  const runs = await ctx.db
    .select({ run: deliveryRuns, courierName: couriers.name })
    .from(deliveryRuns)
    .innerJoin(couriers, eq(couriers.id, deliveryRuns.courierId))
    .where(and(eq(deliveryRuns.businessDayId, day.id), ne(deliveryRuns.status, 'finished')))
    .orderBy(asc(deliveryRuns.createdAt));
  return { orders: rows, runs: runs.map((r) => ({ ...r.run, courierName: r.courierName })) };
}

async function courierFee(tx: DbOrTx, courierId: string, neighborhoodId: string | null) {
  const [c] = await tx.select().from(couriers).where(eq(couriers.id, courierId));
  if (!c || !c.active) throw unprocessable('Entregador inativo ou inexistente');
  let fee = c.defaultFeeCents;
  if (neighborhoodId) {
    const [nb] = await tx.select().from(neighborhoods).where(eq(neighborhoods.id, neighborhoodId));
    if (nb?.courierFeeCents != null) fee = nb.courierFeeCents;
  }
  return fee;
}

async function finishRunIfDone(tx: Tx, runId: string | null) {
  if (!runId) return;
  const [pending] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.deliveryRunId, runId), inArray(orders.deliveryStatus, ['waiting', 'en_route', 'issue'])));
  if (!pending?.c) await tx.update(deliveryRuns).set({ status: 'finished', finishedAt: now() }).where(and(eq(deliveryRuns.id, runId), ne(deliveryRuns.status, 'finished')));
}

/** Agrupamento manual: atribui um ou mais pedidos a um entregador numa mesma saída. */
export async function assignOrders(ctx: Ctx, orderIds: string[], courierId: string) {
  requirePerm(ctx.actor, 'deliveries.manage');
  if (!orderIds.length || orderIds.length > 20) throw badRequest('Selecione de 1 a 20 pedidos');
  return inTx(ctx, async (tx, emit) => {
    const day = await requireOpenDay(tx);
    const list = await tx.select().from(orders).where(inArray(orders.id, orderIds)).for('update');
    if (list.length !== orderIds.length) throw notFound('Pedido não encontrado');
    for (const o of list) {
      if (o.type !== 'delivery' || o.status === 'cancelled' || o.status === 'pending') throw conflict(`Pedido #${o.number} não pode ser atribuído`);
      if (o.deliveryStatus !== 'waiting') throw conflict(`Pedido #${o.number} já saiu para entrega`);
    }
    const [run] = await tx.insert(deliveryRuns).values({ businessDayId: day.id, courierId, createdBy: ctx.actor.userId, createdAt: now() }).returning();
    const previousRuns = new Set<string>();
    for (const o of list) {
      if (o.deliveryRunId) previousRuns.add(o.deliveryRunId);
      const fee = await courierFee(tx, courierId, o.neighborhoodId);
      await tx.update(orders).set({ courierId, deliveryRunId: run!.id, courierFeeCents: fee, updatedAt: now() }).where(eq(orders.id, o.id));
      await orderEvent(tx, o.id, 'delivery.assigned', ctx.actor, { courierId, runId: run!.id, courierFeeCents: fee });
      emit({ type: 'order.changed', orderId: o.id, number: o.number });
    }
    for (const r of previousRuns) await finishRunIfDone(tx, r);
    emit({ type: 'delivery.changed', courierId });
    return run!;
  });
}

export async function unassignOrder(ctx: Ctx, orderId: string) {
  requirePerm(ctx.actor, 'deliveries.manage');
  return inTx(ctx, async (tx, emit) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!o) throw notFound();
    if (o.deliveryStatus !== 'waiting') throw conflict('Pedido já saiu para entrega');
    await tx.update(orders).set({ courierId: null, deliveryRunId: null, courierFeeCents: null, updatedAt: now() }).where(eq(orders.id, o.id));
    await orderEvent(tx, o.id, 'delivery.unassigned', ctx.actor, { courierId: o.courierId });
    await finishRunIfDone(tx, o.deliveryRunId);
    emit({ type: 'delivery.changed', courierId: o.courierId });
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    return { id: o.id };
  });
}

/** Saída para entrega: todos os pedidos do grupo precisam estar prontos. */
export async function departRun(ctx: Ctx, runId: string) {
  return inTx(ctx, async (tx, emit) => {
    const [run] = await tx.select().from(deliveryRuns).where(eq(deliveryRuns.id, runId)).for('update');
    if (!run) throw notFound('Saída não encontrada');
    await assertCanActOnCourier(ctx, tx, run.courierId);
    if (run.status !== 'assigned') throw conflict('Esta saída já foi iniciada');
    const list = await tx.select().from(orders).where(and(eq(orders.deliveryRunId, runId), eq(orders.deliveryStatus, 'waiting'))).for('update');
    if (!list.length) throw conflict('Nenhum pedido nesta saída');
    const notReady = list.filter((o) => o.stage !== 'ready');
    if (notReady.length) throw new AppError(409, 'not_ready', `Pedido(s) ainda em produção: ${notReady.map((o) => '#' + o.number).join(', ')}`);
    const at = now();
    for (const o of list) {
      await tx.update(orders).set({ deliveryStatus: 'en_route', stage: 'out_for_delivery', dispatchedAt: at, updatedAt: at }).where(eq(orders.id, o.id));
      await orderEvent(tx, o.id, 'delivery.departed', ctx.actor, { runId });
      await enqueueOrderNotification(tx, o.id, 'order_dispatched', emit);
      emit({ type: 'order.changed', orderId: o.id, number: o.number });
    }
    await tx.update(deliveryRuns).set({ status: 'en_route', departedAt: at }).where(eq(deliveryRuns.id, runId));
    emit({ type: 'delivery.changed', courierId: run.courierId });
    return { id: runId };
  });
}

async function courierIdForUser(db: DbOrTx, userId: string) {
  const [c] = await db.select().from(couriers).where(eq(couriers.userId, userId));
  return c?.id ?? null;
}

/** Entregador só age sobre as próprias entregas; gestão age sobre todas. */
async function assertCanActOnCourier(ctx: Ctx, db: DbOrTx, courierId: string | null) {
  if (can(ctx.actor.role, 'deliveries.manage')) return;
  if (!can(ctx.actor.role, 'deliveries.own')) throw forbidden();
  const mine = await courierIdForUser(db, ctx.actor.userId);
  if (!mine || mine !== courierId) throw forbidden('Esta entrega não está atribuída a você');
}

export async function setDeliveryStatus(ctx: Ctx, orderId: string, status: DeliveryStatus, note?: string | null) {
  return inTx(ctx, async (tx, emit) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!o || o.type !== 'delivery') throw notFound('Entrega não encontrada');
    await assertCanActOnCourier(ctx, tx, o.courierId);
    if (o.status === 'cancelled') throw conflict('Pedido cancelado');
    const from = o.deliveryStatus ?? 'waiting';
    if (!canTransitionDelivery(from, status)) throw conflict('Mudança de status de entrega inválida');
    if (status === 'issue' && !note?.trim()) throw unprocessable('Descreva a ocorrência');
    const at = now();
    const set: Partial<typeof orders.$inferInsert> = { deliveryStatus: status, updatedAt: at };
    if (status === 'delivered') {
      set.stage = 'delivered';
      set.deliveredAt = at;
    } else if (status === 'issue') {
      set.deliveryIssue = note!.trim().slice(0, 300);
    } else if (status === 'waiting') {
      // retornou à loja: volta para a fila de expedição
      if (!can(ctx.actor.role, 'deliveries.manage')) throw forbidden('Somente a loja pode devolver o pedido à fila');
      Object.assign(set, { stage: 'ready', courierId: null, deliveryRunId: null, courierFeeCents: null, dispatchedAt: null });
    } else if (status === 'en_route') {
      set.stage = 'out_for_delivery';
    }
    await tx.update(orders).set(set).where(eq(orders.id, o.id));
    await orderEvent(tx, o.id, 'delivery.' + status, ctx.actor, note ? { note } : undefined);
    if (status === 'delivered' || status === 'waiting') await finishRunIfDone(tx, o.deliveryRunId);
    emit({ type: 'order.changed', orderId: o.id, number: o.number });
    emit({ type: 'delivery.changed', orderId: o.id, courierId: o.courierId });
    return { id: o.id, deliveryStatus: status };
  });
}

/**
 * Visão do entregador: somente pedidos atribuídos a ele e somente os dados necessários
 * para a entrega (sem histórico, custos ou dados de outros pedidos).
 */
export async function courierView(ctx: Ctx) {
  requirePerm(ctx.actor, 'deliveries.own');
  const courierId = await courierIdForUser(ctx.db, ctx.actor.userId);
  if (!courierId) return { courier: null, runs: [], deliveries: [] };
  const [courier] = await ctx.db.select({ id: couriers.id, name: couriers.name }).from(couriers).where(eq(couriers.id, courierId));
  const day = await requireOpenDay(ctx.db).catch(() => null);
  if (!day) return { courier, runs: [], deliveries: [] };
  const list = await ctx.db
    .select({
      id: orders.id,
      number: orders.number,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      addrStreet: orders.addrStreet,
      addrNumber: orders.addrNumber,
      addrComplement: orders.addrComplement,
      addrReference: orders.addrReference,
      neighborhoodName: orders.neighborhoodName,
      totalCents: orders.totalCents,
      paidCents: orders.paidCents,
      paymentIntent: orders.paymentIntent,
      changeForCents: orders.changeForCents,
      notes: orders.notes,
      deliveryStatus: orders.deliveryStatus,
      deliveryIssue: orders.deliveryIssue,
      deliveryRunId: orders.deliveryRunId,
      courierFeeCents: orders.courierFeeCents,
      stage: orders.stage,
      dispatchedAt: orders.dispatchedAt,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .where(and(eq(orders.courierId, courierId), eq(orders.businessDayId, day.id), ne(orders.status, 'cancelled')))
    .orderBy(asc(orders.createdAt));
  const counts = list.length
    ? await ctx.db
        .select({ orderId: orderItems.orderId, items: sql<number>`sum(${orderItems.quantity})::int` })
        .from(orderItems)
        .where(and(inArray(orderItems.orderId, list.map((o) => o.id)), eq(orderItems.status, 'active')))
        .groupBy(orderItems.orderId)
    : [];
  const runs = await ctx.db
    .select()
    .from(deliveryRuns)
    .where(and(eq(deliveryRuns.courierId, courierId), eq(deliveryRuns.businessDayId, day.id)))
    .orderBy(desc(deliveryRuns.createdAt));
  return {
    courier,
    runs,
    deliveries: list.map((o) => ({ ...o, itemCount: counts.find((c) => c.orderId === o.id)?.items ?? 0, balanceCents: o.totalCents - o.paidCents })),
  };
}

// ---------------- acertos ----------------

export async function courierPending(db: DbOrTx, courierId: string) {
  const delivered = await db
    .select({ id: orders.id, number: orders.number, fee: orders.courierFeeCents, deliveredAt: orders.deliveredAt, neighborhoodName: orders.neighborhoodName })
    .from(orders)
    .where(and(eq(orders.courierId, courierId), eq(orders.deliveryStatus, 'delivered'), isNull(orders.courierSettlementId), ne(orders.status, 'cancelled')))
    .orderBy(asc(orders.deliveredAt));
  const adjustments = await db
    .select()
    .from(courierAdjustments)
    .where(and(eq(courierAdjustments.courierId, courierId), isNull(courierAdjustments.settlementId)))
    .orderBy(asc(courierAdjustments.createdAt));
  const fees = delivered.reduce((a, o) => a + (o.fee ?? 0), 0);
  const adj = adjustments.reduce((a, x) => a + (x.type === 'bonus' ? x.amountCents : -x.amountCents), 0);
  return { deliveries: delivered, adjustments, deliveriesCount: delivered.length, feesCents: fees, adjustmentsCents: adj, totalCents: fees + adj };
}

export async function addAdjustment(ctx: Ctx, courierId: string, input: { type: 'bonus' | 'deduction'; amountCents: number; reason: string }) {
  requirePerm(ctx.actor, 'couriers.settle');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw badRequest('Valor inválido');
  if (!input.reason?.trim()) throw unprocessable('Informe o motivo');
  return inTx(ctx, async (tx, emit) => {
    const day = await requireOpenDay(tx).catch(() => null);
    const [row] = await tx
      .insert(courierAdjustments)
      .values({ courierId, businessDayId: day?.id ?? null, type: input.type, amountCents: input.amountCents, reason: input.reason.trim(), createdBy: ctx.actor.userId, createdAt: now() })
      .returning();
    await audit(tx, ctx.actor, 'courier.adjustment', 'courier', courierId, input);
    emit({ type: 'delivery.changed', courierId });
    return row!;
  });
}

export async function settleCourier(ctx: Ctx, courierId: string, input: { paidFromCash: boolean; notes?: string | null; expectedTotalCents: number }, idem?: IdemKey) {
  requirePerm(ctx.actor, 'couriers.settle');
  return inTx(ctx, async (tx, emit) => {
    const r = await idempotent(tx, idem, async () => {
      // trava o entregador para impedir dois acertos simultâneos
      const [c] = await tx.select().from(couriers).where(eq(couriers.id, courierId)).for('update');
      if (!c) throw notFound('Entregador não encontrado');
      const p = await courierPending(tx, courierId);
      if (p.deliveriesCount === 0 && p.adjustments.length === 0) throw conflict('Nada pendente para acerto');
      if (p.totalCents !== input.expectedTotalCents) {
        throw new AppError(409, 'settlement_changed', 'Os valores pendentes mudaram. Revise antes de confirmar.', { totalCents: p.totalCents });
      }
      if (p.totalCents < 0) throw unprocessable('O acerto resultaria em valor negativo. Revise os descontos.');
      let cashMovementId: string | null = null;
      if (input.paidFromCash && p.totalCents > 0) {
        const cash = await requireOpenCash(tx);
        if ((await cashBalance(tx, cash.id)) < p.totalCents) throw new AppError(422, 'insufficient_cash', 'Dinheiro em caixa insuficiente para o repasse');
        const [m] = await tx
          .insert(cashMovements)
          .values({ cashSessionId: cash.id, type: 'courier_payout', method: 'cash', amountCents: -p.totalCents, reason: `Acerto ${c.name}`, createdBy: ctx.actor.userId, createdAt: now() })
          .returning();
        cashMovementId = m!.id;
        emit({ type: 'cash.changed' });
      }
      const [s] = await tx
        .insert(courierSettlements)
        .values({
          courierId,
          deliveriesCount: p.deliveriesCount,
          deliveryFeesCents: p.feesCents,
          adjustmentsCents: p.adjustmentsCents,
          totalCents: p.totalCents,
          paidFromCash: input.paidFromCash,
          cashMovementId,
          notes: input.notes ?? null,
          createdBy: ctx.actor.userId,
          createdAt: now(),
        })
        .returning();
      if (p.deliveries.length) await tx.update(orders).set({ courierSettlementId: s!.id }).where(inArray(orders.id, p.deliveries.map((d) => d.id)));
      if (p.adjustments.length) await tx.update(courierAdjustments).set({ settlementId: s!.id }).where(inArray(courierAdjustments.id, p.adjustments.map((a) => a.id)));
      await audit(tx, ctx.actor, 'courier.settle', 'courier', courierId, { totalCents: p.totalCents, deliveries: p.deliveriesCount, paidFromCash: input.paidFromCash });
      return { settlementId: s!.id, totalCents: p.totalCents };
    });
    emit({ type: 'delivery.changed', courierId });
    return r.value;
  });
}

export async function listSettlements(db: DbOrTx, courierId?: string) {
  const q = db
    .select({ s: courierSettlements, courierName: couriers.name })
    .from(courierSettlements)
    .innerJoin(couriers, eq(couriers.id, courierSettlements.courierId))
    .orderBy(desc(courierSettlements.createdAt))
    .limit(100);
  const rows = await (courierId ? q.where(eq(courierSettlements.courierId, courierId)) : q);
  return rows.map((r) => ({ ...r.s, courierName: r.courierName }));
}
