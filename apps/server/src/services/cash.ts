import { and, desc, eq, sql } from 'drizzle-orm';
import { can, type PaymentMethod } from '@guto/core';
import type { DbOrTx } from '../db/index.js';
import { cashMovements, cashSessions, users } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { idempotent, type IdemKey } from '../lib/idempotency.js';
import { requireOpenDay } from './businessDay.js';

export async function currentCash(db: DbOrTx) {
  const [s] = await db.select().from(cashSessions).where(eq(cashSessions.status, 'open'));
  return s ?? null;
}

export async function requireOpenCash(db: DbOrTx) {
  const s = await currentCash(db);
  if (!s) throw new AppError(409, 'cash_closed', 'Abra o caixa para registrar pagamentos e movimentações');
  return s;
}

export async function openCash(ctx: Ctx, openingCents: number) {
  requirePerm(ctx.actor, 'cash.open');
  if (!Number.isSafeInteger(openingCents) || openingCents < 0) throw badRequest('Valor inicial inválido');
  return inTx(ctx, async (tx, emit) => {
    const day = await requireOpenDay(tx);
    if (await currentCash(tx)) throw conflict('Já existe um caixa aberto');
    const at = now();
    const [s] = await tx
      .insert(cashSessions)
      .values({ businessDayId: day.id, openedAt: at, openedBy: ctx.actor.userId, openingCents })
      .returning();
    await tx.insert(cashMovements).values({
      cashSessionId: s!.id,
      type: 'opening',
      method: 'cash',
      amountCents: openingCents,
      reason: 'Fundo de troco',
      createdBy: ctx.actor.userId,
      createdAt: at,
    });
    await audit(tx, ctx.actor, 'cash.open', 'cash_session', s!.id, { openingCents });
    emit({ type: 'cash.changed' });
    return s!;
  });
}

export async function addCashMovement(
  ctx: Ctx,
  input: { type: 'supply' | 'withdrawal'; amountCents: number; reason: string },
  idem?: IdemKey,
) {
  requirePerm(ctx.actor, 'cash.movement');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw badRequest('Valor deve ser positivo');
  if (!input.reason?.trim()) throw badRequest('Informe o motivo');
  return inTx(ctx, async (tx, emit) => {
    const r = await idempotent(tx, idem, async () => {
      const s = await requireOpenCash(tx);
      if (input.type === 'withdrawal') {
        const bal = await cashBalance(tx, s.id);
        if (input.amountCents > bal) throw new AppError(422, 'insufficient_cash', 'Sangria maior que o dinheiro em caixa');
      }
      const [m] = await tx
        .insert(cashMovements)
        .values({
          cashSessionId: s.id,
          type: input.type,
          method: 'cash',
          amountCents: input.type === 'withdrawal' ? -input.amountCents : input.amountCents,
          reason: input.reason.trim(),
          createdBy: ctx.actor.userId,
          createdAt: now(),
        })
        .returning();
      await audit(tx, ctx.actor, 'cash.' + input.type, 'cash_movement', m!.id, { amountCents: input.amountCents });
      return { id: m!.id };
    });
    emit({ type: 'cash.changed' });
    return r.value;
  });
}

/** Dinheiro físico esperado na gaveta (somente movimentos em espécie). */
export async function cashBalance(db: DbOrTx, sessionId: string): Promise<number> {
  const [r] = await db
    .select({ total: sql<number>`coalesce(sum(${cashMovements.amountCents}), 0)::int` })
    .from(cashMovements)
    .where(and(eq(cashMovements.cashSessionId, sessionId), eq(cashMovements.method, 'cash')));
  return r?.total ?? 0;
}

export async function cashSummary(db: DbOrTx, sessionId: string) {
  const rows = await db
    .select({
      type: cashMovements.type,
      method: cashMovements.method,
      total: sql<number>`sum(${cashMovements.amountCents})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(cashMovements)
    .where(eq(cashMovements.cashSessionId, sessionId))
    .groupBy(cashMovements.type, cashMovements.method);
  const byMethod: Partial<Record<PaymentMethod, { received: number; refunded: number; net: number }>> = {};
  let supplies = 0;
  let withdrawals = 0;
  let opening = 0;
  let courierPayouts = 0;
  let expensesPaid = 0;
  for (const r of rows) {
    if (r.type === 'payment' || r.type === 'refund') {
      const m = (byMethod[r.method] ??= { received: 0, refunded: 0, net: 0 });
      if (r.type === 'payment') m.received += r.total;
      else m.refunded += -r.total;
      m.net += r.total;
    } else if (r.type === 'supply') supplies += r.total;
    else if (r.type === 'withdrawal') withdrawals += -r.total;
    else if (r.type === 'opening') opening += r.total;
    else if (r.type === 'courier_payout') courierPayouts += -r.total;
    else if (r.type === 'expense') expensesPaid += -r.total;
  }
  const expectedCash = await cashBalance(db, sessionId);
  const totalReceived = Object.values(byMethod).reduce((a, m) => a + (m?.net ?? 0), 0);
  return { opening, supplies, withdrawals, courierPayouts, expensesPaid, byMethod, totalReceived, expectedCash };
}

export async function getCashView(ctx: Ctx, sessionId?: string) {
  const s = sessionId
    ? (await ctx.db.select().from(cashSessions).where(eq(cashSessions.id, sessionId)))[0]
    : await currentCash(ctx.db);
  if (!s) return null;
  const summary = await cashSummary(ctx.db, s.id);
  const movements = await ctx.db
    .select({
      id: cashMovements.id,
      type: cashMovements.type,
      method: cashMovements.method,
      amountCents: cashMovements.amountCents,
      reason: cashMovements.reason,
      orderId: cashMovements.orderId,
      createdAt: cashMovements.createdAt,
      userName: users.name,
    })
    .from(cashMovements)
    .leftJoin(users, eq(users.id, cashMovements.createdBy))
    .where(eq(cashMovements.cashSessionId, s.id))
    .orderBy(desc(cashMovements.createdAt));
  // Conferência "cega": quem não pode ver o esperado só o vê após fechar
  const showExpected = can(ctx.actor.role, 'cash.view_expected') || s.status === 'closed';
  return {
    session: s,
    summary: showExpected ? summary : { ...summary, expectedCash: null, byMethod: null, totalReceived: null },
    movements,
  };
}

export async function closeCash(
  ctx: Ctx,
  input: { countedCashCents: number; justification?: string; sessionVersionCheck?: string },
  authorizedBy: string | null,
) {
  if (!Number.isSafeInteger(input.countedCashCents) || input.countedCashCents < 0) throw badRequest('Valor contado inválido');
  return inTx(ctx, async (tx, emit) => {
    const [s] = await tx.select().from(cashSessions).where(eq(cashSessions.status, 'open')).for('update');
    if (!s) throw notFound('Nenhum caixa aberto');
    const summary = await cashSummary(tx, s.id);
    const difference = input.countedCashCents - summary.expectedCash;
    if (difference !== 0 && !input.justification?.trim()) {
      throw new AppError(422, 'justification_required', 'Há divergência entre o valor contado e o esperado. Informe a justificativa.', {
        differenceCents: difference,
      });
    }
    const [closed] = await tx
      .update(cashSessions)
      .set({
        status: 'closed',
        closedAt: now(),
        closedBy: ctx.actor.userId,
        expectedCashCents: summary.expectedCash,
        countedCashCents: input.countedCashCents,
        differenceCents: difference,
        justification: input.justification?.trim() || null,
        summary,
      })
      .where(eq(cashSessions.id, s.id))
      .returning();
    await audit(
      tx,
      ctx.actor,
      'cash.close',
      'cash_session',
      s.id,
      { expected: summary.expectedCash, counted: input.countedCashCents, difference },
      authorizedBy,
    );
    emit({ type: 'cash.changed' });
    return { session: closed!, summary };
  });
}

export async function listCashSessions(db: DbOrTx, limit = 30) {
  return db.select().from(cashSessions).orderBy(desc(cashSessions.openedAt)).limit(limit);
}
