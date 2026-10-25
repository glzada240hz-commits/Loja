import { and, asc, eq, inArray } from 'drizzle-orm';
import { unitTotal, validateOptionSelections, type OptionGroupRule } from '@guto/core';
import type { DbOrTx } from '../db/index.js';
import {
  categories,
  comboItems,
  optionGroups,
  options,
  productOptionGroups,
  products,
  productVariants,
  recipeItems,
  stockItems,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { toMilli } from './stock.js';

export interface MenuOption {
  id: string;
  name: string;
  priceCents: number;
  costCents: number | null;
  available: boolean;
  sort: number;
}
export interface MenuGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOption[];
}
export interface MenuVariant {
  id: string;
  name: string;
  priceCents: number;
  costCents: number | null;
  available: boolean;
}
export interface MenuProduct {
  id: string;
  categoryId: string;
  code: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  kind: 'simple' | 'combo';
  available: boolean;
  showOnline: boolean;
  sort: number;
  variants: MenuVariant[];
  groups: MenuGroup[];
  combo: { variantId: string; quantity: number; label: string }[];
}
export interface MenuCategory {
  id: string;
  name: string;
  sort: number;
  sendToKitchen: boolean;
  products: MenuProduct[];
}

/** Cardápio completo (somente registros ativos). `publicView` remove custos e itens ocultos. */
export async function getMenu(db: DbOrTx, opts: { publicView?: boolean } = {}): Promise<MenuCategory[]> {
  const cats = await db.select().from(categories).where(eq(categories.active, true)).orderBy(asc(categories.sort), asc(categories.name));
  const prods = await db.select().from(products).where(eq(products.active, true)).orderBy(asc(products.sort), asc(products.name));
  const vars = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.active, true))
    .orderBy(asc(productVariants.sort), asc(productVariants.priceCents));
  const links = await db.select().from(productOptionGroups).orderBy(asc(productOptionGroups.sort));
  const groups = await db.select().from(optionGroups).where(eq(optionGroups.active, true));
  const optRows = await db.select().from(options).where(eq(options.active, true)).orderBy(asc(options.sort), asc(options.name));
  const combos = await db.select().from(comboItems);

  const groupMap = new Map<string, MenuGroup>();
  for (const g of groups) {
    groupMap.set(g.id, {
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: optRows
        .filter((o) => o.groupId === g.id)
        .map((o) => ({
          id: o.id,
          name: o.name,
          priceCents: o.priceCents,
          costCents: o.costCents,
          available: o.available,
          sort: o.sort,
        })),
    });
  }
  const varName = new Map<string, string>();
  for (const v of vars) {
    const p = prods.find((x) => x.id === v.productId);
    varName.set(v.id, p ? (v.name === 'Único' ? p.name : `${p.name} ${v.name}`) : v.name);
  }
  const result: MenuCategory[] = cats.map((c) => ({
    id: c.id,
    name: c.name,
    sort: c.sort,
    sendToKitchen: c.sendToKitchen,
    products: prods
      .filter((p) => p.categoryId === c.id && (!opts.publicView || p.showOnline))
      .map((p) => ({
        id: p.id,
        categoryId: p.categoryId,
        code: p.code,
        name: p.name,
        description: p.description,
        imagePath: p.imagePath,
        kind: p.kind,
        available: p.available,
        showOnline: p.showOnline,
        sort: p.sort,
        variants: vars
          .filter((v) => v.productId === p.id)
          .map((v) => ({ id: v.id, name: v.name, priceCents: v.priceCents, costCents: v.costCents, available: v.available })),
        groups: links
          .filter((l) => l.productId === p.id)
          .map((l) => groupMap.get(l.groupId))
          .filter((g): g is MenuGroup => !!g),
        combo: combos
          .filter((ci) => ci.comboProductId === p.id)
          .map((ci) => ({ variantId: ci.componentVariantId, quantity: ci.quantity, label: varName.get(ci.componentVariantId) ?? '?' })),
      }))
      .filter((p) => p.variants.length > 0),
  }));
  if (opts.publicView) {
    for (const c of result)
      for (const p of c.products) {
        for (const v of p.variants) v.costCents = null;
        for (const g of p.groups) g.options = g.options.map((o) => ({ ...o, costCents: null }));
      }
    return result.filter((c) => c.products.length > 0);
  }
  return result;
}

// ---------------- Precificação no servidor ----------------

export interface ItemInput {
  variantId: string;
  quantity: number;
  options?: { optionId: string; quantity: number }[];
  notes?: string | null;
}

export interface ResolvedItem {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string | null;
  categoryName: string;
  sendToKitchen: boolean;
  quantity: number;
  unitPriceCents: number;
  optionsUnitCents: number;
  totalCents: number;
  unitCostCents: number | null;
  notes: string | null;
  comboComponents: { variantId: string; quantity: number; label: string }[] | null;
  options: { optionId: string; groupName: string; optionName: string; priceCents: number; costCents: number | null; quantity: number }[];
}

/**
 * Resolve itens a partir do cardápio ATUAL do banco: preços, disponibilidade e regras de adicionais.
 * O que o navegador enviou como preço é ignorado.
 */
export async function resolveItems(db: DbOrTx, inputs: ItemInput[], opts: { online?: boolean } = {}): Promise<ResolvedItem[]> {
  if (!inputs.length) throw unprocessable('O pedido precisa de pelo menos um item');
  if (inputs.length > 100) throw unprocessable('Itens demais em um único lançamento');
  const menu = await getMenu(db);
  const byVariant = new Map<string, { cat: MenuCategory; prod: MenuProduct; variant: MenuVariant }>();
  for (const cat of menu) for (const prod of cat.products) for (const variant of prod.variants) byVariant.set(variant.id, { cat, prod, variant });

  const errors: string[] = [];
  const out: ResolvedItem[] = [];
  for (const input of inputs) {
    const ref = byVariant.get(input.variantId);
    if (!ref) {
      errors.push('Produto não encontrado ou removido do cardápio');
      continue;
    }
    const { cat, prod, variant } = ref;
    const label = variant.name === 'Único' ? prod.name : `${prod.name} (${variant.name})`;
    if (!prod.available || !variant.available) errors.push(`${label} está indisponível no momento`);
    if (opts.online && !prod.showOnline) errors.push(`${label} não está disponível no cardápio digital`);
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) {
      errors.push(`Quantidade inválida para ${label}`);
      continue;
    }
    const rules: OptionGroupRule[] = prod.groups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => ({ id: o.id, name: o.name, available: o.available })),
    }));
    const sel = input.options ?? [];
    const selErrors = validateOptionSelections(rules, sel);
    errors.push(...selErrors.map((e) => `${label}: ${e}`));
    if (selErrors.length) continue;

    const resolvedOptions = sel.map((s) => {
      const g = prod.groups.find((gg) => gg.options.some((o) => o.id === s.optionId))!;
      const o = g.options.find((oo) => oo.id === s.optionId)!;
      return { optionId: o.id, groupName: g.name, optionName: o.name, priceCents: o.priceCents, costCents: o.costCents, quantity: s.quantity };
    });
    const unit = unitTotal({ unitPriceCents: variant.priceCents, options: resolvedOptions });
    let unitCost: number | null = variant.costCents;
    for (const o of resolvedOptions) {
      // adicional gratuito sem custo cadastrado (ex.: "sem cebola") não torna o custo incompleto
      if (o.costCents === null) {
        if (o.priceCents > 0) unitCost = null;
      } else if (unitCost !== null) unitCost += o.costCents * o.quantity;
    }
    const notes = input.notes?.trim().slice(0, 300) || null;
    out.push({
      productId: prod.id,
      variantId: variant.id,
      productName: prod.name,
      variantName: variant.name === 'Único' ? null : variant.name,
      categoryName: cat.name,
      sendToKitchen: cat.sendToKitchen,
      quantity: input.quantity,
      unitPriceCents: variant.priceCents,
      optionsUnitCents: unit - variant.priceCents,
      totalCents: unit * input.quantity,
      unitCostCents: unitCost,
      notes,
      comboComponents: prod.kind === 'combo' ? prod.combo : null,
      options: resolvedOptions,
    });
  }
  if (errors.length) throw unprocessable(errors[0]!, { errors });
  return out;
}

// ---------------- Administração do cardápio ----------------

export async function saveCategory(ctx: Ctx, input: { id?: string; name: string; sort?: number; sendToKitchen?: boolean; active?: boolean }) {
  requirePerm(ctx.actor, 'menu.manage');
  if (!input.name?.trim()) throw badRequest('Informe o nome da categoria');
  const values = { name: input.name.trim(), sort: input.sort ?? 0, sendToKitchen: input.sendToKitchen ?? true, active: input.active ?? true };
  return inTx(ctx, async (tx, emit) => {
    const [row] = input.id
      ? await tx.update(categories).set(values).where(eq(categories.id, input.id)).returning()
      : await tx.insert(categories).values(values).returning();
    if (!row) throw notFound();
    await audit(tx, ctx.actor, 'menu.category.save', 'category', row.id, values);
    emit({ type: 'menu.changed' });
    return row;
  });
}

export interface ProductInput {
  id?: string;
  categoryId: string;
  code?: string | null;
  name: string;
  description?: string | null;
  kind?: 'simple' | 'combo';
  available?: boolean;
  showOnline?: boolean;
  sort?: number;
  variants: { id?: string; name: string; priceCents: number; costCents?: number | null; available?: boolean }[];
  groupIds?: string[];
  combo?: { variantId: string; quantity: number }[];
}

export async function saveProduct(ctx: Ctx, input: ProductInput) {
  requirePerm(ctx.actor, 'menu.manage');
  if (!input.name?.trim()) throw badRequest('Informe o nome do produto');
  if (!input.variants?.length) throw badRequest('Cadastre ao menos um tamanho/preço');
  for (const v of input.variants) {
    if (!Number.isSafeInteger(v.priceCents) || v.priceCents < 0) throw badRequest('Preço inválido');
    if (v.costCents != null && (!Number.isSafeInteger(v.costCents) || v.costCents < 0)) throw badRequest('Custo inválido');
  }
  if (input.kind === 'combo' && !input.combo?.length) throw badRequest('Combo precisa de itens');
  return inTx(ctx, async (tx, emit) => {
    const values = {
      categoryId: input.categoryId,
      code: input.code?.trim() || null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      kind: input.kind ?? 'simple',
      available: input.available ?? true,
      showOnline: input.showOnline ?? true,
      sort: input.sort ?? 0,
      updatedAt: now(),
    };
    const [prod] = input.id
      ? await tx.update(products).set(values).where(eq(products.id, input.id)).returning()
      : await tx.insert(products).values(values).returning();
    if (!prod) throw notFound('Produto não encontrado');

    const existing = await tx.select().from(productVariants).where(eq(productVariants.productId, prod.id));
    const keep = new Set<string>();
    let sort = 0;
    for (const v of input.variants) {
      const vals = {
        name: v.name.trim() || 'Único',
        priceCents: v.priceCents,
        costCents: v.costCents ?? null,
        available: v.available ?? true,
        sort: sort++,
        active: true,
      };
      if (v.id && existing.some((e) => e.id === v.id)) {
        await tx.update(productVariants).set(vals).where(eq(productVariants.id, v.id));
        keep.add(v.id);
      } else {
        const [nv] = await tx.insert(productVariants).values({ ...vals, productId: prod.id }).returning();
        keep.add(nv!.id);
      }
    }
    // variantes removidas são desativadas (pedidos antigos guardam seu próprio retrato)
    for (const e of existing) if (!keep.has(e.id)) await tx.update(productVariants).set({ active: false }).where(eq(productVariants.id, e.id));

    if (input.groupIds) {
      await tx.delete(productOptionGroups).where(eq(productOptionGroups.productId, prod.id));
      let s = 0;
      for (const gid of input.groupIds) await tx.insert(productOptionGroups).values({ productId: prod.id, groupId: gid, sort: s++ });
    }
    if (input.combo) {
      await tx.delete(comboItems).where(eq(comboItems.comboProductId, prod.id));
      for (const c of input.combo) {
        if (keep.has(c.variantId)) throw badRequest('Um combo não pode conter a si mesmo');
        await tx.insert(comboItems).values({ comboProductId: prod.id, componentVariantId: c.variantId, quantity: Math.max(1, c.quantity) });
      }
    }
    await audit(tx, ctx.actor, input.id ? 'menu.product.update' : 'menu.product.create', 'product', prod.id, {
      name: values.name,
      variants: input.variants.map((v) => ({ name: v.name, priceCents: v.priceCents })),
    });
    emit({ type: 'menu.changed' });
    return prod;
  });
}

export async function setProductImage(ctx: Ctx, productId: string, imagePath: string | null) {
  requirePerm(ctx.actor, 'menu.manage');
  const [p] = await ctx.db.update(products).set({ imagePath, updatedAt: now() }).where(eq(products.id, productId)).returning();
  if (!p) throw notFound();
  ctx.bus.publish({ type: 'menu.changed' });
  return p;
}

export async function archiveProduct(ctx: Ctx, productId: string) {
  requirePerm(ctx.actor, 'menu.manage');
  await inTx(ctx, async (tx, emit) => {
    const [p] = await tx.update(products).set({ active: false, updatedAt: now() }).where(eq(products.id, productId)).returning();
    if (!p) throw notFound();
    await audit(tx, ctx.actor, 'menu.product.archive', 'product', productId, { name: p.name });
    emit({ type: 'menu.changed' });
  });
}

/** Disponibilidade rápida (ex.: acabou o bacon). Pode ser feita pelo caixa? Não: exige menu.manage. */
export async function setAvailability(ctx: Ctx, target: 'product' | 'variant' | 'option', id: string, available: boolean) {
  requirePerm(ctx.actor, 'menu.manage');
  const table = target === 'product' ? products : target === 'variant' ? productVariants : options;
  const rows = await ctx.db.update(table).set({ available }).where(eq(table.id, id)).returning({ id: table.id });
  if (!rows.length) throw notFound();
  await audit(ctx.db, ctx.actor, 'menu.availability', target, id, { available });
  ctx.bus.publish({ type: 'menu.changed' });
}

export interface GroupInput {
  id?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { id?: string; name: string; priceCents: number; costCents?: number | null; available?: boolean }[];
}

export async function saveOptionGroup(ctx: Ctx, input: GroupInput) {
  requirePerm(ctx.actor, 'menu.manage');
  if (!input.name?.trim()) throw badRequest('Informe o nome do grupo');
  if (input.minSelect < 0 || input.maxSelect < 0 || (input.maxSelect > 0 && input.minSelect > input.maxSelect)) {
    throw badRequest('Limites de seleção inválidos');
  }
  return inTx(ctx, async (tx, emit) => {
    const vals = { name: input.name.trim(), minSelect: input.minSelect, maxSelect: input.maxSelect, active: true };
    const [g] = input.id
      ? await tx.update(optionGroups).set(vals).where(eq(optionGroups.id, input.id)).returning()
      : await tx.insert(optionGroups).values(vals).returning();
    if (!g) throw notFound();
    const existing = await tx.select().from(options).where(eq(options.groupId, g.id));
    const keep = new Set<string>();
    let sort = 0;
    for (const o of input.options) {
      if (!Number.isSafeInteger(o.priceCents) || o.priceCents < 0) throw badRequest('Preço de adicional inválido');
      const ov = { name: o.name.trim(), priceCents: o.priceCents, costCents: o.costCents ?? null, available: o.available ?? true, sort: sort++, active: true };
      if (o.id && existing.some((e) => e.id === o.id)) {
        await tx.update(options).set(ov).where(eq(options.id, o.id));
        keep.add(o.id);
      } else {
        const [n] = await tx.insert(options).values({ ...ov, groupId: g.id }).returning();
        keep.add(n!.id);
      }
    }
    for (const e of existing) if (!keep.has(e.id)) await tx.update(options).set({ active: false }).where(eq(options.id, e.id));
    await audit(tx, ctx.actor, 'menu.group.save', 'option_group', g.id, vals);
    emit({ type: 'menu.changed' });
    return g;
  });
}

export async function listOptionGroups(db: DbOrTx) {
  const groups = await db.select().from(optionGroups).where(eq(optionGroups.active, true)).orderBy(asc(optionGroups.name));
  const opts = await db.select().from(options).where(eq(options.active, true)).orderBy(asc(options.sort));
  return groups.map((g) => ({ ...g, options: opts.filter((o) => o.groupId === g.id) }));
}

export async function getRecipe(db: DbOrTx, target: { variantId?: string; optionId?: string }) {
  const where = target.variantId ? eq(recipeItems.variantId, target.variantId) : eq(recipeItems.optionId, target.optionId!);
  return db
    .select({ id: recipeItems.id, stockItemId: recipeItems.stockItemId, quantity: recipeItems.quantity, name: stockItems.name, unit: stockItems.unit })
    .from(recipeItems)
    .innerJoin(stockItems, eq(stockItems.id, recipeItems.stockItemId))
    .where(where);
}

export async function saveRecipe(
  ctx: Ctx,
  target: { variantId?: string; optionId?: string },
  items: { stockItemId: string; quantity: string }[],
) {
  requirePerm(ctx.actor, 'menu.manage');
  if (!!target.variantId === !!target.optionId) throw badRequest('Informe variante ou adicional');
  for (const i of items) if (toMilli(i.quantity) <= 0n) throw badRequest('Quantidade da ficha técnica deve ser positiva');
  return inTx(ctx, async (tx) => {
    const where = target.variantId ? eq(recipeItems.variantId, target.variantId) : eq(recipeItems.optionId, target.optionId!);
    await tx.delete(recipeItems).where(where);
    for (const i of items) {
      await tx.insert(recipeItems).values({ variantId: target.variantId ?? null, optionId: target.optionId ?? null, stockItemId: i.stockItemId, quantity: i.quantity });
    }
    await audit(tx, ctx.actor, 'menu.recipe.save', target.variantId ? 'variant' : 'option', (target.variantId ?? target.optionId)!, { items });
    return getRecipe(tx, target);
  });
}

/** Custo estimado de uma variante pela ficha técnica (para sugerir o campo custo). */
export async function recipeCost(db: DbOrTx, variantId: string): Promise<{ costCents: number | null; complete: boolean }> {
  const rows = await db
    .select({ quantity: recipeItems.quantity, unitCost: stockItems.unitCostCents })
    .from(recipeItems)
    .innerJoin(stockItems, eq(stockItems.id, recipeItems.stockItemId))
    .where(and(eq(recipeItems.variantId, variantId)));
  if (!rows.length) return { costCents: null, complete: false };
  let total = 0;
  let complete = true;
  for (const r of rows) {
    if (r.unitCost == null) {
      complete = false;
      continue;
    }
    total += (Number(r.quantity) * Number(r.unitCost));
  }
  return { costCents: Math.round(total), complete };
}

export async function variantsByIds(db: DbOrTx, ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(productVariants).where(inArray(productVariants.id, ids));
}
