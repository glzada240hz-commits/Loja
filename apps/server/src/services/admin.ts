import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { localDateISO, normalizePhoneBR, ROLES, type Role } from '@guto/core';
import type { DbOrTx } from '../db/index.js';
import {
  auditLogs,
  cashMovements,
  customerAddresses,
  customers,
  expenses,
  neighborhoods,
  orders,
  users,
  waContacts,
  waMessages,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { hashPassword } from '../lib/crypto.js';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { revokeUserSessions } from './auth.js';
import { currentDay } from './businessDay.js';
import { cashBalance, requireOpenCash } from './cash.js';

// ---------------- usuários ----------------

export async function listUsers(ctx: Ctx) {
  requirePerm(ctx.actor, 'users.manage');
  return ctx.db
    .select({ id: users.id, name: users.name, username: users.username, role: users.role, active: users.active, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.name));
}

export function validatePassword(pw: string) {
  if (typeof pw !== 'string' || pw.length < 8) throw unprocessable('A senha precisa ter pelo menos 8 caracteres');
  if (pw.length > 200) throw unprocessable('Senha muito longa');
}

export async function saveUser(ctx: Ctx, input: { id?: string; name: string; username: string; role: Role; active?: boolean; password?: string }) {
  requirePerm(ctx.actor, 'users.manage');
  if (!ROLES.includes(input.role)) throw badRequest('Perfil inválido');
  const username = input.username?.trim().toLowerCase();
  if (!username || !/^[a-z0-9._-]{3,40}$/.test(username)) throw unprocessable('Usuário deve ter 3 a 40 caracteres (letras, números, . _ -)');
  if (!input.name?.trim()) throw unprocessable('Informe o nome');
  if (!input.id && !input.password) throw unprocessable('Defina uma senha inicial');
  if (input.password) validatePassword(input.password);
  return inTx(ctx, async (tx) => {
    const [dup] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (dup && dup.id !== input.id) throw conflict('Nome de usuário já existe');
    if (input.id === ctx.actor.userId && (input.active === false || input.role !== 'admin')) {
      throw conflict('Você não pode desativar ou rebaixar o próprio usuário');
    }
    const vals: Partial<typeof users.$inferInsert> = { name: input.name.trim(), username, role: input.role, active: input.active ?? true, updatedAt: now() };
    if (input.password) vals.passwordHash = await hashPassword(input.password);
    let row;
    if (input.id) {
      [row] = await tx.update(users).set(vals).where(eq(users.id, input.id)).returning();
      if (!row) throw notFound();
      if (input.password || input.active === false) await revokeUserSessions(tx, row.id);
    } else {
      [row] = await tx.insert(users).values(vals as typeof users.$inferInsert).returning();
    }
    if (row!.role !== 'admin') {
      const [admins] = await tx.select({ c: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, 'admin'), eq(users.active, true)));
      if (!admins?.c) throw conflict('O sistema precisa de pelo menos um administrador ativo');
    }
    await audit(tx, ctx.actor, input.id ? 'user.update' : 'user.create', 'user', row!.id, { username, role: input.role, active: vals.active, passwordChanged: !!input.password });
    return { id: row!.id, name: row!.name, username: row!.username, role: row!.role, active: row!.active };
  });
}

// ---------------- bairros ----------------

export async function listNeighborhoods(db: DbOrTx, onlyActive = false) {
  const q = db.select().from(neighborhoods).orderBy(asc(neighborhoods.name));
  return onlyActive ? q.where(eq(neighborhoods.active, true)) : q;
}

export async function saveNeighborhood(
  ctx: Ctx,
  input: { id?: string; name: string; feeCents: number; courierFeeCents?: number | null; minOrderCents?: number; etaMinutes?: number; active?: boolean },
) {
  requirePerm(ctx.actor, 'settings.manage');
  if (!input.name?.trim()) throw badRequest('Informe o bairro');
  for (const v of [input.feeCents, input.courierFeeCents ?? 0, input.minOrderCents ?? 0]) if (!Number.isSafeInteger(v) || v < 0) throw badRequest('Valor inválido');
  const vals = {
    name: input.name.trim(),
    feeCents: input.feeCents,
    courierFeeCents: input.courierFeeCents ?? null,
    minOrderCents: input.minOrderCents ?? 0,
    etaMinutes: input.etaMinutes ?? 45,
    active: input.active ?? true,
  };
  return inTx(ctx, async (tx) => {
    const [r] = input.id ? await tx.update(neighborhoods).set(vals).where(eq(neighborhoods.id, input.id)).returning() : await tx.insert(neighborhoods).values(vals).returning();
    if (!r) throw notFound();
    await audit(tx, ctx.actor, 'neighborhood.save', 'neighborhood', r.id, vals);
    return r;
  });
}

// ---------------- clientes ----------------

export async function searchCustomers(ctx: Ctx, q: string) {
  requirePerm(ctx.actor, 'customers.view');
  const term = q.trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, '');
  const like = `%${term}%`;
  const rows = await ctx.db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      notes: customers.notes,
      orders: sql<number>`(select count(*)::int from orders o where o.customer_id = ${customers.id} and o.status <> 'cancelled')`,
      lastOrderAt: sql<string | null>`(select max(created_at) from orders o where o.customer_id = ${customers.id})`,
    })
    .from(customers)
    .where(and(isNull(customers.anonymizedAt), or(ilike(customers.name, like), digits.length >= 3 ? ilike(customers.phone, `%${digits}%`) : sql`false`)))
    .orderBy(asc(customers.name))
    .limit(20);
  return rows;
}

export async function getCustomer(ctx: Ctx, id: string) {
  requirePerm(ctx.actor, 'customers.view');
  const [c] = await ctx.db.select().from(customers).where(eq(customers.id, id));
  if (!c) throw notFound('Cliente não encontrado');
  const addresses = await ctx.db.select().from(customerAddresses).where(eq(customerAddresses.customerId, id)).orderBy(desc(customerAddresses.lastUsedAt));
  const history = await ctx.db
    .select({ id: orders.id, number: orders.number, type: orders.type, status: orders.status, totalCents: orders.totalCents, createdAt: orders.createdAt })
    .from(orders)
    .where(eq(orders.customerId, id))
    .orderBy(desc(orders.createdAt))
    .limit(30);
  const [wa] = c.phone ? await ctx.db.select().from(waContacts).where(eq(waContacts.customerId, id)) : [];
  return { ...c, addresses, history, whatsapp: wa ?? null };
}

export async function customerByPhone(ctx: Ctx, phone: string) {
  requirePerm(ctx.actor, 'customers.view');
  const p = normalizePhoneBR(phone);
  if (!p) return null;
  const [c] = await ctx.db.select().from(customers).where(eq(customers.phone, p));
  if (!c) return null;
  return getCustomer(ctx, c.id);
}

export async function updateCustomer(ctx: Ctx, id: string, input: { name?: string; phone?: string | null; notes?: string | null }) {
  requirePerm(ctx.actor, 'customers.manage');
  const set: Partial<typeof customers.$inferInsert> = { updatedAt: now() };
  if (input.name !== undefined) set.name = input.name.trim() || 'Cliente';
  if (input.phone !== undefined) {
    const p = input.phone ? normalizePhoneBR(input.phone) : null;
    if (input.phone && !p) throw badRequest('Telefone inválido');
    set.phone = p;
  }
  if (input.notes !== undefined) set.notes = input.notes?.trim() || null;
  try {
    const [r] = await ctx.db.update(customers).set(set).where(eq(customers.id, id)).returning();
    if (!r) throw notFound();
    return r;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('Já existe cliente com este telefone');
    throw e;
  }
}

export async function deleteAddress(ctx: Ctx, customerId: string, addressId: string) {
  requirePerm(ctx.actor, 'customers.manage');
  await ctx.db.delete(customerAddresses).where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.customerId, customerId)));
}

/**
 * Exclusão de dados pessoais a pedido do titular: remove nome, telefone, endereços e conversa,
 * mantendo os registros financeiros dos pedidos (valores e itens) de forma anonimizada.
 */
export async function anonymizeCustomer(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx.actor, 'customers.erase');
  if (!reason?.trim()) throw unprocessable('Informe o motivo/pedido do titular');
  return inTx(ctx, async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, id)).for('update');
    if (!c) throw notFound();
    const [open] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.customerId, id), sql`${orders.status} in ('pending','open')`));
    if (open?.c) throw conflict('Cliente tem pedidos em aberto');
    await tx
      .update(orders)
      .set({ customerName: 'Cliente removido', customerPhone: null, addrStreet: null, addrNumber: null, addrComplement: null, addrReference: null, trackingToken: null })
      .where(eq(orders.customerId, id));
    await tx.delete(customerAddresses).where(eq(customerAddresses.customerId, id));
    const contacts = await tx.select().from(waContacts).where(eq(waContacts.customerId, id));
    for (const w of contacts) {
      await tx.delete(waMessages).where(eq(waMessages.contactId, w.id));
      await tx.delete(waContacts).where(eq(waContacts.id, w.id));
    }
    await tx.update(customers).set({ name: 'Cliente removido', phone: null, notes: null, anonymizedAt: now(), updatedAt: now() }).where(eq(customers.id, id));
    await audit(tx, ctx.actor, 'customer.anonymize', 'customer', id, { reason: reason.trim() });
    return { id };
  });
}

// ---------------- despesas ----------------

export async function listExpenses(ctx: Ctx, from: string, to: string) {
  requirePerm(ctx.actor, 'expenses.manage');
  return ctx.db
    .select()
    .from(expenses)
    .where(and(isNull(expenses.deletedAt), sql`${expenses.date} between ${from} and ${to}`))
    .orderBy(desc(expenses.date), desc(expenses.createdAt));
}

export async function createExpense(ctx: Ctx, input: { date?: string; category: string; description: string; amountCents: number; paidFromCash: boolean }) {
  requirePerm(ctx.actor, 'expenses.manage');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw badRequest('Valor inválido');
  if (!input.category?.trim() || !input.description?.trim()) throw unprocessable('Categoria e descrição são obrigatórias');
  const date = input.date ?? localDateISO(now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Data inválida');
  return inTx(ctx, async (tx, emit) => {
    const day = await currentDay(tx);
    let cashMovementId: string | null = null;
    if (input.paidFromCash) {
      const cash = await requireOpenCash(tx);
      if ((await cashBalance(tx, cash.id)) < input.amountCents) throw new AppError(422, 'insufficient_cash', 'Dinheiro em caixa insuficiente');
      const [m] = await tx
        .insert(cashMovements)
        .values({ cashSessionId: cash.id, type: 'expense', method: 'cash', amountCents: -input.amountCents, reason: input.description.trim(), createdBy: ctx.actor.userId, createdAt: now() })
        .returning();
      cashMovementId = m!.id;
      emit({ type: 'cash.changed' });
    }
    const [e] = await tx
      .insert(expenses)
      .values({
        date,
        businessDayId: day?.id ?? null,
        category: input.category.trim(),
        description: input.description.trim(),
        amountCents: input.amountCents,
        paidFromCash: input.paidFromCash,
        cashMovementId,
        createdBy: ctx.actor.userId,
        createdAt: now(),
      })
      .returning();
    await audit(tx, ctx.actor, 'expense.create', 'expense', e!.id, { amountCents: input.amountCents, category: input.category });
    return e!;
  });
}

export async function deleteExpense(ctx: Ctx, id: string) {
  requirePerm(ctx.actor, 'expenses.manage');
  return inTx(ctx, async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id));
    if (!e || e.deletedAt) throw notFound();
    if (e.paidFromCash) throw conflict('Despesa paga pelo caixa não pode ser excluída; registre um suprimento para corrigir');
    await tx.update(expenses).set({ deletedAt: now() }).where(eq(expenses.id, id));
    await audit(tx, ctx.actor, 'expense.delete', 'expense', id, { amountCents: e.amountCents });
  });
}

// ---------------- auditoria ----------------

export async function listAudit(ctx: Ctx, filters: { entity?: string; limit?: number }) {
  requirePerm(ctx.actor, 'audit.view');
  const authName = sql<string | null>`(select name from users u2 where u2.id = ${auditLogs.authorizedBy})`;
  const q = ctx.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      data: auditLogs.data,
      createdAt: auditLogs.createdAt,
      userName: users.name,
      authorizedByName: authName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .orderBy(desc(auditLogs.id))
    .limit(Math.min(filters.limit ?? 200, 1000));
  return filters.entity ? q.where(eq(auditLogs.entity, filters.entity)) : q;
}
