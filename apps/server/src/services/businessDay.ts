import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { localDateISO } from '@guto/core';
import type { DbOrTx } from '../db/index.js';
import { businessDays, cashSessions, orders } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { AppError, conflict } from '../lib/errors.js';

export async function currentDay(db: DbOrTx) {
  const [d] = await db.select().from(businessDays).where(eq(businessDays.status, 'open'));
  return d ?? null;
}

export async function requireOpenDay(db: DbOrTx) {
  const d = await currentDay(db);
  if (!d) throw new AppError(409, 'day_closed', 'Nenhum dia operacional aberto. Abra o dia para registrar pedidos.');
  return d;
}

export async function openDay(ctx: Ctx, notes?: string) {
  requirePerm(ctx.actor, 'business_day.open');
  return inTx(ctx, async (tx, emit) => {
    if (await currentDay(tx)) throw conflict('Já existe um dia operacional aberto');
    const at = now();
    const [d] = await tx
      .insert(businessDays)
      .values({ referenceDate: localDateISO(at), openedAt: at, openedBy: ctx.actor.userId, notes: notes ?? null })
      .returning();
    await audit(tx, ctx.actor, 'business_day.open', 'business_day', d!.id, { referenceDate: d!.referenceDate });
    emit({ type: 'day.changed' });
    return d!;
  });
}

/**
 * Fecha o dia operacional. O fechamento independe da data do calendário: pedidos feitos
 * após a meia-noite continuam pertencendo ao dia aberto até este fechamento.
 */
export async function closeDay(ctx: Ctx) {
  requirePerm(ctx.actor, 'business_day.manage');
  return inTx(ctx, async (tx, emit) => {
    const [d] = await tx.select().from(businessDays).where(eq(businessDays.status, 'open')).for('update');
    if (!d) throw conflict('Não há dia operacional aberto');
    const pendingOrders = await tx
      .select({ id: orders.id, number: orders.number, status: orders.status })
      .from(orders)
      .where(and(eq(orders.businessDayId, d.id), inArray(orders.status, ['pending', 'open'])));
    if (pendingOrders.length) {
      throw new AppError(409, 'day_has_open_orders', 'Finalize ou cancele os pedidos em aberto antes de fechar o dia', {
        orders: pendingOrders,
      });
    }
    const [openCash] = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(and(eq(cashSessions.businessDayId, d.id), eq(cashSessions.status, 'open')));
    if (openCash) throw new AppError(409, 'cash_open', 'Feche o caixa antes de fechar o dia');
    const at = now();
    const [closed] = await tx
      .update(businessDays)
      .set({ status: 'closed', closedAt: at, closedBy: ctx.actor.userId })
      .where(eq(businessDays.id, d.id))
      .returning();
    await audit(tx, ctx.actor, 'business_day.close', 'business_day', d.id, { orders: d.lastOrderNumber });
    emit({ type: 'day.changed' });
    return closed!;
  });
}

export async function listDays(db: DbOrTx, limit = 60) {
  return db
    .select({
      id: businessDays.id,
      referenceDate: businessDays.referenceDate,
      status: businessDays.status,
      openedAt: businessDays.openedAt,
      closedAt: businessDays.closedAt,
      orders: businessDays.lastOrderNumber,
    })
    .from(businessDays)
    .orderBy(desc(businessDays.openedAt))
    .limit(limit);
}

/** Reserva o próximo número visível do dia (com bloqueio de linha: sem números repetidos). */
export async function nextOrderNumber(tx: DbOrTx, dayId: string): Promise<number> {
  const [r] = await tx
    .update(businessDays)
    .set({ lastOrderNumber: sql`${businessDays.lastOrderNumber} + 1` })
    .where(and(eq(businessDays.id, dayId), eq(businessDays.status, 'open')))
    .returning({ n: businessDays.lastOrderNumber });
  if (!r) throw new AppError(409, 'day_closed', 'O dia operacional foi fechado');
  return r.n;
}
