import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/index.js';
import { orderItemOptions, recipeItems, stockItems, stockMovements, users } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Quantidades de estoque usam 3 casas decimais. Para somar sem ponto flutuante
 * trabalhamos em milésimos inteiros (BigInt) e convertemos para string numeric.
 */
export function toMilli(q: string | number): bigint {
  const s = String(q).trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) throw badRequest('Quantidade inválida: ' + s);
  const v = BigInt(m[2]!) * 1000n + BigInt((m[3] ?? '').padEnd(3, '0'));
  return m[1] ? -v : v;
}
export function fromMilli(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = `${a / 1000n}.${(a % 1000n).toString().padStart(3, '0')}`;
  return neg ? '-' + s : s;
}

interface ItemForStock {
  id: string;
  variantId: string | null;
  quantity: number;
  comboComponents: unknown;
}

/** Calcula o consumo de insumos de um item de pedido pela ficha técnica (em milésimos). */
export async function consumptionFor(tx: DbOrTx, item: ItemForStock): Promise<Map<string, bigint>> {
  const total = new Map<string, bigint>();
  const add = (stockItemId: string, q: bigint) => total.set(stockItemId, (total.get(stockItemId) ?? 0n) + q);
  const variantIds: { id: string; mult: bigint }[] = [];
  if (item.variantId) variantIds.push({ id: item.variantId, mult: BigInt(item.quantity) });
  const combo = Array.isArray(item.comboComponents) ? (item.comboComponents as { variantId: string; quantity: number }[]) : [];
  for (const c of combo) variantIds.push({ id: c.variantId, mult: BigInt(item.quantity * c.quantity) });
  if (variantIds.length) {
    const rec = await tx
      .select()
      .from(recipeItems)
      .where(inArray(recipeItems.variantId, variantIds.map((v) => v.id)));
    for (const v of variantIds) {
      for (const r of rec.filter((x) => x.variantId === v.id)) add(r.stockItemId, toMilli(r.quantity) * v.mult);
    }
  }
  const opts = await tx.select().from(orderItemOptions).where(eq(orderItemOptions.orderItemId, item.id));
  const optIds = opts.map((o) => o.optionId).filter((x): x is string => !!x);
  if (optIds.length) {
    const rec = await tx.select().from(recipeItems).where(inArray(recipeItems.optionId, optIds));
    for (const o of opts) {
      for (const r of rec.filter((x) => x.optionId === o.optionId)) {
        add(r.stockItemId, toMilli(r.quantity) * BigInt(o.quantity * item.quantity));
      }
    }
  }
  return total;
}

async function applyMovement(
  tx: DbOrTx,
  m: { stockItemId: string; type: 'entry' | 'sale' | 'sale_reversal' | 'loss' | 'adjustment' | 'manual_out'; qtyMilli: bigint; reason?: string | null; sourceType?: string; sourceId?: string; userId?: string | null; unitCostCents?: string | null },
) {
  // índice único (source_type, source_id, stock_item_id, type) impede baixa duplicada
  const inserted = await tx
    .insert(stockMovements)
    .values({
      stockItemId: m.stockItemId,
      type: m.type,
      quantity: fromMilli(m.qtyMilli),
      reason: m.reason ?? null,
      sourceType: m.sourceType ?? null,
      sourceId: m.sourceId ?? null,
      createdBy: m.userId ?? null,
      unitCostCents: m.unitCostCents ?? null,
      createdAt: now(),
    })
    .onConflictDoNothing()
    .returning({ id: stockMovements.id });
  if (inserted.length === 0) return false;
  await tx
    .update(stockItems)
    .set({ quantity: sql`${stockItems.quantity} + ${fromMilli(m.qtyMilli)}::numeric`, updatedAt: now() })
    .where(eq(stockItems.id, m.stockItemId));
  return true;
}

/** Baixa por venda (uma única vez por item de pedido). */
export async function deductForItem(tx: DbOrTx, item: ItemForStock, userId: string | null) {
  const cons = await consumptionFor(tx, item);
  for (const [stockItemId, q] of cons) {
    if (q === 0n) continue;
    await applyMovement(tx, { stockItemId, type: 'sale', qtyMilli: -q, sourceType: 'order_item', sourceId: item.id, userId });
  }
}

/**
 * Cancelamento: 'return' devolve ao estoque (item não produzido);
 * 'loss' estorna a venda e registra a mesma quantidade como perda (item já produzido/descartado).
 * Só atua sobre o que de fato foi baixado (consulta os movimentos de venda do item).
 */
export async function reverseForItem(tx: DbOrTx, itemId: string, mode: 'return' | 'loss', userId: string | null, reason: string) {
  const sales = await tx
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.sourceType, 'order_item'), eq(stockMovements.sourceId, itemId), eq(stockMovements.type, 'sale')));
  for (const s of sales) {
    const q = -toMilli(s.quantity);
    await applyMovement(tx, { stockItemId: s.stockItemId, type: 'sale_reversal', qtyMilli: q, sourceType: 'order_item', sourceId: itemId, userId, reason });
    if (mode === 'loss') {
      await applyMovement(tx, { stockItemId: s.stockItemId, type: 'loss', qtyMilli: -q, sourceType: 'order_item', sourceId: itemId, userId, reason });
    }
  }
}

// ---------------- Cadastro e movimentações manuais ----------------

export async function listStock(db: DbOrTx) {
  const rows = await db.select().from(stockItems).where(eq(stockItems.active, true)).orderBy(stockItems.name);
  return rows.map((r) => ({ ...r, low: toMilli(r.quantity) <= toMilli(r.minQuantity) }));
}

export async function saveStockItem(
  ctx: Ctx,
  input: { id?: string; name: string; unit: string; minQuantity: string; unitCostCents?: string | null; active?: boolean },
) {
  requirePerm(ctx.actor, 'stock.manage');
  toMilli(input.minQuantity);
  const values = {
    name: input.name.trim(),
    unit: input.unit,
    minQuantity: input.minQuantity,
    unitCostCents: input.unitCostCents ?? null,
    active: input.active ?? true,
    updatedAt: now(),
  };
  return inTx(ctx, async (tx, emit) => {
    const [row] = input.id
      ? await tx.update(stockItems).set(values).where(eq(stockItems.id, input.id)).returning()
      : await tx.insert(stockItems).values(values).returning();
    if (!row) throw notFound();
    await audit(tx, ctx.actor, input.id ? 'stock.update' : 'stock.create', 'stock_item', row.id, values);
    emit({ type: 'stock.changed' });
    return row;
  });
}

export async function manualMovement(
  ctx: Ctx,
  input: { stockItemId: string; type: 'entry' | 'loss' | 'manual_out' | 'adjustment'; quantity: string; reason: string; unitCostCents?: string | null },
) {
  requirePerm(ctx.actor, 'stock.manage');
  if (!input.reason?.trim()) throw badRequest('Informe o motivo');
  return inTx(ctx, async (tx, emit) => {
    const [item] = await tx.select().from(stockItems).where(eq(stockItems.id, input.stockItemId)).for('update');
    if (!item) throw notFound('Insumo não encontrado');
    const q = toMilli(input.quantity);
    let delta: bigint;
    if (input.type === 'adjustment') {
      if (q < 0n) throw badRequest('Quantidade contada não pode ser negativa');
      delta = q - toMilli(item.quantity); // ajuste: informa a quantidade contada
    } else {
      if (q <= 0n) throw badRequest('Quantidade deve ser positiva');
      delta = input.type === 'entry' ? q : -q;
    }
    await applyMovement(tx, {
      stockItemId: item.id,
      type: input.type,
      qtyMilli: delta,
      reason: input.reason.trim(),
      userId: ctx.actor.userId,
      unitCostCents: input.unitCostCents ?? null,
    });
    if (input.type === 'entry' && input.unitCostCents) {
      await tx.update(stockItems).set({ unitCostCents: input.unitCostCents }).where(eq(stockItems.id, item.id));
    }
    await audit(tx, ctx.actor, 'stock.' + input.type, 'stock_item', item.id, { quantity: input.quantity, delta: fromMilli(delta) });
    emit({ type: 'stock.changed' });
    return { delta: fromMilli(delta) };
  });
}

export async function listMovements(db: DbOrTx, stockItemId?: string, limit = 200) {
  const q = db
    .select({
      id: stockMovements.id,
      stockItemId: stockMovements.stockItemId,
      itemName: stockItems.name,
      unit: stockItems.unit,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      reason: stockMovements.reason,
      sourceType: stockMovements.sourceType,
      sourceId: stockMovements.sourceId,
      createdAt: stockMovements.createdAt,
      userName: users.name,
    })
    .from(stockMovements)
    .innerJoin(stockItems, eq(stockItems.id, stockMovements.stockItemId))
    .leftJoin(users, eq(users.id, stockMovements.createdBy))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
  return stockItemId ? q.where(eq(stockMovements.stockItemId, stockItemId)) : q;
}

