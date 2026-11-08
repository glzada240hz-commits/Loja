import { and, asc, eq, gte, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { canTransitionKitchen, deliveryAddressLine, deliveryCollectText, formatPhoneBR, placeLabel, type KitchenStatus } from '@guto/core';
import type { DbOrTx } from '../db/index.js';
import { kitchenTickets, orderItemOptions, orderItems, orders } from '../db/schema.js';
import { orderEvent } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { conflict, notFound } from '../lib/errors.js';
import { refreshStage } from './orders.js';

/** Fila da cozinha: tickets pendentes + prontos/cancelados recentes (para conferência). */
export async function kitchenQueue(db: DbOrTx) {
  const recent = new Date(now().getTime() - 20 * 60000);
  return loadTickets(
    db,
    or(
      and(eq(orders.status, 'open'), inArray(kitchenTickets.status, ['received', 'preparing'])),
      and(eq(orders.status, 'closed'), inArray(kitchenTickets.status, ['received', 'preparing'])),
      and(inArray(orders.status, ['open', 'closed']), eq(kitchenTickets.status, 'ready'), gte(kitchenTickets.readyAt, recent), isNull(kitchenTickets.servedAt)),
      and(eq(orders.status, 'cancelled'), gte(orders.cancelledAt, recent)),
    )!,
  );
}

/** Tickets de um pedido (ou um ticket) para imprimir de novo, mesmo os já prontos ou entregues. */
export async function ticketsForReprint(db: DbOrTx, by: { ticketId?: string; orderId?: string }) {
  const where = by.ticketId ? eq(kitchenTickets.id, by.ticketId) : eq(kitchenTickets.orderId, by.orderId!);
  return loadTickets(db, and(where, ne(orders.status, 'cancelled'))!);
}

async function loadTickets(db: DbOrTx, where: SQL) {
  const rows = await db
    .select({
      ticket: kitchenTickets,
      orderNumber: orders.number,
      deliveryNumber: orders.deliveryNumber,
      orderType: orders.type,
      orderStatus: orders.status,
      tableLabel: orders.tableLabel,
      tabKind: orders.tabKind,
      createdByName: sql<string | null>`(select name from users u where u.id = ${kitchenTickets.createdBy})`,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      orderNotes: orders.notes,
      etaAt: orders.etaAt,
      source: orders.source,
      addrStreet: orders.addrStreet,
      addrNumber: orders.addrNumber,
      addrComplement: orders.addrComplement,
      addrReference: orders.addrReference,
      neighborhoodName: orders.neighborhoodName,
      totalCents: orders.totalCents,
      paidCents: orders.paidCents,
      paymentIntent: orders.paymentIntent,
      paymentPlan: orders.paymentPlan,
      changeForCents: orders.changeForCents,
      greenSauce: orders.greenSauce,
    })
    .from(kitchenTickets)
    .innerJoin(orders, eq(orders.id, kitchenTickets.orderId))
    .where(where)
    .orderBy(asc(kitchenTickets.createdAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.ticket.id);
  const items = await db.select().from(orderItems).where(inArray(orderItems.ticketId, ids)).orderBy(asc(orderItems.sort));
  const opts = items.length ? await db.select().from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, items.map((i) => i.id))) : [];
  return rows
    .map((r) => ({
      ...r.ticket,
      orderNumber: r.orderNumber,
      deliveryNumber: r.deliveryNumber,
      greenSauce: r.orderType === 'delivery' ? r.greenSauce : null,
      orderType: r.orderType,
      orderStatus: r.orderStatus,
      tableLabel: r.tableLabel,
      tabKind: r.tabKind,
      place: placeLabel({ type: r.orderType, tabKind: r.tabKind, tableLabel: r.tableLabel }),
      createdByName: r.createdByName,
      customerName: r.customerName,
      orderNotes: r.orderNotes,
      // entrega: endereço e o que cobrar, impressos na via para o motoboy
      delivery:
        r.orderType === 'delivery'
          ? {
              address: deliveryAddressLine({ street: r.addrStreet, number: r.addrNumber, complement: r.addrComplement }),
              neighborhood: r.neighborhoodName,
              reference: r.addrReference,
              phone: r.customerPhone ? formatPhoneBR(r.customerPhone) : null,
              collect: deliveryCollectText(r),
            }
          : null,
      etaAt: r.etaAt,
      source: r.source,
      items: items
        .filter((i) => i.ticketId === r.ticket.id)
        .map((i) => ({
          id: i.id,
          productName: i.productName,
          variantName: i.variantName,
          quantity: i.quantity,
          notes: i.notes,
          status: i.status,
          comboComponents: i.comboComponents,
          options: opts.filter((o) => o.orderItemId === i.id).map((o) => ({ name: o.optionName, group: o.groupName, quantity: o.quantity })),
        })),
    }))
    .filter((t) => t.items.length > 0);
}

export async function setTicketStatus(ctx: Ctx, ticketId: string, status: KitchenStatus) {
  requirePerm(ctx.actor, 'kitchen.update');
  return inTx(ctx, async (tx, emit) => {
    const [t] = await tx.select().from(kitchenTickets).where(eq(kitchenTickets.id, ticketId)).for('update');
    if (!t) throw notFound('Ticket não encontrado');
    const [o] = await tx.select().from(orders).where(eq(orders.id, t.orderId));
    if (!o || o.status === 'cancelled') throw conflict('Pedido cancelado');
    if (t.status === status) return { id: t.id, status };
    if (!canTransitionKitchen(t.status, status)) throw conflict('Mudança de status inválida');
    const at = now();
    await tx
      .update(kitchenTickets)
      .set({
        status,
        startedAt: status === 'preparing' ? (t.startedAt ?? at) : status === 'received' ? null : (t.startedAt ?? at),
        readyAt: status === 'ready' ? at : null,
      })
      .where(eq(kitchenTickets.id, t.id));
    await orderEvent(tx, t.orderId, 'kitchen', ctx.actor, { round: t.round, from: t.status, to: status });
    await refreshStage(tx, t.orderId, emit);
    emit({ type: 'kitchen.changed', orderId: t.orderId });
    emit({ type: 'order.changed', orderId: t.orderId, number: o.number });
    return { id: t.id, status };
  });
}

/** Conta tickets por status (para indicadores). */
export async function kitchenCounts(db: DbOrTx) {
  return db
    .select({ status: kitchenTickets.status, count: sql<number>`count(*)::int` })
    .from(kitchenTickets)
    .innerJoin(orders, eq(orders.id, kitchenTickets.orderId))
    .where(and(eq(orders.status, 'open'), inArray(kitchenTickets.status, ['received', 'preparing'])))
    .groupBy(kitchenTickets.status);
}
