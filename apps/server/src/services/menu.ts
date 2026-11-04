import { and, asc, eq, inArray } from 'drizzle-orm';
import { unitTotal, validateOptionSelections, type OptionGroupRule } from '@guto/core';
import type { DbOrTx } from '../db/index.js';
import {
  categories,
  comboItems,
  neighborhoods,
  optionGroups,
  options,
  productOptionGroups,
  products,
  productVariants,
  recipeItems,
  stockItems,
  users,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { toMilli } from './stock.js';
import { getSettings, updateSettings } from './settings.js';
import type { Deps } from '../lib/context.js';
import { EXAMPLE_CATEGORIES, EXAMPLE_GROUPS, EXAMPLE_NEIGHBORHOODS, EXAMPLE_PRODUCTS, OFFICIAL_ADDON_GROUPS, OFFICIAL_MENU, OFFICIAL_MENU_VERSION, OFFICIAL_NEIGHBORHOODS, OFFICIAL_REMOVALS, OFFICIAL_STORE } from '../db/cardapio-oficial.js';

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

/**
 * Coloca um item do estoque à venda (ex.: refrigerante, cerveja, água): cria o produto no cardápio, com um
 * preço, e a ficha técnica que baixa `quantityPerSale` do item a cada venda. Aparece no PDV, nas mesas e no
 * app do atendente na hora.
 */
export async function sellStockItem(
  ctx: Ctx,
  stockItemId: string,
  input: { categoryId: string; priceCents: number; name?: string | null; code?: string | null; quantityPerSale?: string; showOnline?: boolean },
) {
  requirePerm(ctx.actor, 'menu.manage');
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents <= 0) throw badRequest('Informe o preço de venda');
  const per = input.quantityPerSale ?? '1';
  if (toMilli(per) <= 0n) throw badRequest('Quantidade por venda deve ser positiva');
  return inTx(ctx, async (tx, emit) => {
    const [item] = await tx.select().from(stockItems).where(and(eq(stockItems.id, stockItemId), eq(stockItems.active, true)));
    if (!item) throw notFound('Item do estoque não encontrado');
    const [cat] = await tx.select().from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.active, true)));
    if (!cat) throw badRequest('Escolha uma categoria do cardápio');
    const code = input.code?.trim() || null;
    if (code) {
      const [dup] = await tx.select({ id: products.id }).from(products).where(and(eq(products.code, code), eq(products.active, true)));
      if (dup) throw unprocessable(`O código ${code} já é de outro produto`);
    }
    const unitCost = item.unitCostCents != null ? Math.round(Number(item.unitCostCents) * (Number(toMilli(per)) / 1000)) : null;
    const [prod] = await tx
      .insert(products)
      .values({ categoryId: cat.id, code, name: (input.name?.trim() || item.name).slice(0, 80), kind: 'simple', showOnline: input.showOnline ?? true, updatedAt: now() })
      .returning();
    const [variant] = await tx.insert(productVariants).values({ productId: prod!.id, name: 'Único', priceCents: input.priceCents, costCents: unitCost }).returning();
    await tx.insert(recipeItems).values({ variantId: variant!.id, optionId: null, stockItemId: item.id, quantity: per });
    await audit(tx, ctx.actor, 'menu.product.create', 'product', prod!.id, { fromStockItem: item.id, name: prod!.name, priceCents: input.priceCents, quantityPerSale: per });
    emit({ type: 'menu.changed' });
    emit({ type: 'stock.changed' });
    return { product: prod!, variant: variant! };
  });
}

const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface OfficialImportResult {
  version: string;
  created: string[];
  updated: string[];
  archived: string[];
  kept: string[];
  codesSkipped: string[];
  storeUpdated: boolean;
  neighborhoods?: number;
}

/**
 * Importa o cardápio oficial do Bar do Guto (db/cardapio-oficial.ts). Pode ser repetido sem duplicar: produtos
 * são localizados pelo nome. Com `archiveExamples`, tira de venda os produtos/adicionais de EXEMPLO (preços
 * inventados) e as fichas técnicas de exemplo dos lanches de mesmo nome. Nada é apagado: pedidos antigos
 * continuam com seus próprios dados e produtos do dono que não estão no cardápio continuam à venda.
 */
export async function importOfficialMenu(ctx: Ctx, opts: { archiveExamples: boolean; updateStore: boolean }): Promise<OfficialImportResult> {
  requirePerm(ctx.actor, 'menu.manage');
  return inTx(ctx, async (tx, emit) => {
    const res: OfficialImportResult = { version: OFFICIAL_MENU_VERSION, created: [], updated: [], archived: [], kept: [], codesSkipped: [], storeUpdated: false };
    const official = new Set(OFFICIAL_MENU.flatMap((c) => c.products.map((p) => norm(p.name))));
    const exampleNames = new Set(EXAMPLE_PRODUCTS.map(norm));
    let active = await tx.select().from(products).where(eq(products.active, true));

    if (opts.archiveExamples) {
      for (const p of active) {
        if (exampleNames.has(norm(p.name)) && !official.has(norm(p.name))) {
          await tx.update(products).set({ active: false, code: null, updatedAt: now() }).where(eq(products.id, p.id));
          res.archived.push(p.name);
        }
      }
      const groups = await tx.select().from(optionGroups).where(eq(optionGroups.active, true));
      for (const g of groups.filter((g) => EXAMPLE_GROUPS.map(norm).includes(norm(g.name)))) {
        await tx.update(optionGroups).set({ active: false }).where(eq(optionGroups.id, g.id));
        await tx.delete(productOptionGroups).where(eq(productOptionGroups.groupId, g.id));
        res.archived.push(`Adicionais de exemplo (${g.name})`);
      }
      active = active.filter((p) => !res.archived.includes(p.name));
    }

    const byName = new Map<string, (typeof active)[number]>();
    for (const p of active) if (!byName.has(norm(p.name))) byName.set(norm(p.name), p);
    // os códigos serão reatribuídos: libera os dos produtos que serão atualizados (evita troca circular)
    for (const n of official) {
      const ex = byName.get(n);
      if (ex?.code) await tx.update(products).set({ code: null }).where(eq(products.id, ex.id));
    }

    // grupo gratuito "Retirar ingredientes" dos hambúrgueres
    let [retirar] = await tx.select().from(optionGroups).where(and(eq(optionGroups.active, true), eq(optionGroups.name, 'Retirar ingredientes')));
    if (!retirar) [retirar] = await tx.insert(optionGroups).values({ name: 'Retirar ingredientes', minSelect: 0, maxSelect: 0, sort: 2 }).returning();
    const curOpts = await tx.select().from(options).where(eq(options.groupId, retirar!.id));
    for (const o of curOpts) if (!OFFICIAL_REMOVALS.map(norm).includes(norm(o.name))) await tx.update(options).set({ active: false }).where(eq(options.id, o.id));
    for (const [i, name] of OFFICIAL_REMOVALS.entries()) {
      const ex = curOpts.find((o) => norm(o.name) === norm(name));
      if (ex) await tx.update(options).set({ name, priceCents: 0, active: true, available: true, sort: i }).where(eq(options.id, ex.id));
      else await tx.insert(options).values({ groupId: retirar!.id, name, priceCents: 0, costCents: 0, sort: i });
    }

    const cats = await tx.select().from(categories).where(eq(categories.active, true));
    let cSort = 0;
    for (const oc of OFFICIAL_MENU) {
      const found = cats.find((c) => norm(c.name) === norm(oc.name));
      const [cat] = found
        ? await tx.update(categories).set({ name: oc.name, sendToKitchen: oc.sendToKitchen, sort: cSort }).where(eq(categories.id, found.id)).returning()
        : await tx.insert(categories).values({ name: oc.name, sendToKitchen: oc.sendToKitchen, sort: cSort }).returning();
      cSort++;
      let pSort = 0;
      for (const op of oc.products) {
        const ex = byName.get(norm(op.name));
        const values = { categoryId: cat!.id, name: op.name, description: op.description ?? null, kind: 'simple' as const, active: true, sort: pSort++, updatedAt: now() };
        let prodId: string;
        if (ex) {
          await tx.update(products).set(values).where(eq(products.id, ex.id));
          prodId = ex.id;
          res.updated.push(op.name);
        } else {
          const [np] = await tx.insert(products).values({ ...values, showOnline: true, available: true }).returning();
          prodId = np!.id;
          res.created.push(op.name);
        }
        // código do PDV, se livre
        const [taken] = await tx.select({ id: products.id }).from(products).where(and(eq(products.code, op.code), eq(products.active, true)));
        if (taken && taken.id !== prodId) res.codesSkipped.push(`${op.name} (código ${op.code} já usado)`);
        else await tx.update(products).set({ code: op.code }).where(eq(products.id, prodId));

        // preços: atualiza a variante de mesmo nome (ou a única), cria as que faltam, desativa as demais
        const vars = ex ? await tx.select().from(productVariants).where(and(eq(productVariants.productId, prodId), eq(productVariants.active, true))) : [];
        const used = new Set<string>();
        let vSort = 0;
        for (const ov of op.variants) {
          const match = vars.find((v) => !used.has(v.id) && norm(v.name) === norm(ov.name)) ?? (op.variants.length === 1 && vars.length === 1 ? vars[0] : undefined);
          const exampleCost = ex && exampleNames.has(norm(ex.name)) && opts.archiveExamples;
          if (match) {
            used.add(match.id);
            await tx.update(productVariants).set({ name: ov.name, priceCents: ov.priceCents, sort: vSort++, ...(exampleCost ? { costCents: null } : {}) }).where(eq(productVariants.id, match.id));
            if (exampleCost) await tx.delete(recipeItems).where(eq(recipeItems.variantId, match.id)); // ficha técnica de exemplo
          } else {
            const [nv] = await tx.insert(productVariants).values({ productId: prodId, name: ov.name, priceCents: ov.priceCents, sort: vSort++ }).returning();
            used.add(nv!.id);
          }
        }
        for (const v of vars) if (!used.has(v.id)) await tx.update(productVariants).set({ active: false }).where(eq(productVariants.id, v.id));
        if (ex) await tx.delete(comboItems).where(eq(comboItems.comboProductId, prodId));
        if (oc.removals) {
          // garante o "Retirar ingredientes" sem tirar outros grupos (ex.: Acréscimos cadastrados pela loja)
          const [linked] = await tx.select().from(productOptionGroups).where(and(eq(productOptionGroups.productId, prodId), eq(productOptionGroups.groupId, retirar!.id)));
          if (!linked) await tx.insert(productOptionGroups).values({ productId: prodId, groupId: retirar!.id, sort: 0 });
        }
      }
    }

    // acréscimos pagos (verde) por categoria: cria/atualiza o grupo e coloca em todos os produtos da categoria
    const catsNow = await tx.select().from(categories).where(eq(categories.active, true));
    const prodsNow = await tx.select({ id: products.id, categoryId: products.categoryId, name: products.name }).from(products).where(eq(products.active, true));
    for (const [gi, ag] of OFFICIAL_ADDON_GROUPS.entries()) {
      let [g] = await tx.select().from(optionGroups).where(and(eq(optionGroups.active, true), eq(optionGroups.name, ag.name)));
      if (g) await tx.update(optionGroups).set({ minSelect: 0, maxSelect: ag.maxSelect }).where(eq(optionGroups.id, g.id));
      else [g] = await tx.insert(optionGroups).values({ name: ag.name, minSelect: 0, maxSelect: ag.maxSelect, sort: gi }).returning();
      const cur = await tx.select().from(options).where(eq(options.groupId, g!.id));
      for (const [i, o] of ag.options.entries()) {
        const ex = cur.find((c) => norm(c.name) === norm(o.name));
        if (ex) await tx.update(options).set({ name: o.name, priceCents: o.priceCents, active: true, sort: i }).where(eq(options.id, ex.id));
        else await tx.insert(options).values({ groupId: g!.id, name: o.name, priceCents: o.priceCents, sort: i });
      }
      for (const c of cur) if (!ag.options.some((o) => norm(o.name) === norm(c.name))) await tx.update(options).set({ active: false }).where(eq(options.id, c.id));
      const catIds = catsNow.filter((c) => ag.categories.some((n) => norm(n) === norm(c.name))).map((c) => c.id);
      const links = await tx.select().from(productOptionGroups).where(eq(productOptionGroups.groupId, g!.id));
      const target = prodsNow.filter(
        (x) => catIds.includes(x.categoryId) && (!ag.only?.length || ag.only.some((n) => norm(n) === norm(x.name))) && !ag.except?.some((n) => norm(n) === norm(x.name)),
      );
      for (const p of target) {
        if (!links.some((l) => l.productId === p.id)) await tx.insert(productOptionGroups).values({ productId: p.id, groupId: g!.id, sort: gi - 10 });
      }
      // tira o grupo de quem não deve ter (ex.: troca de carne no X-Picanha)
      for (const l of links) if (!target.some((t) => t.id === l.productId)) await tx.delete(productOptionGroups).where(and(eq(productOptionGroups.productId, l.productId), eq(productOptionGroups.groupId, g!.id)));
    }

    // categorias que não são do cardápio oficial (ex.: as do dono) ficam depois das oficiais
    let extra = 100;
    for (const c of cats) if (!OFFICIAL_MENU.some((oc) => norm(oc.name) === norm(c.name))) await tx.update(categories).set({ sort: extra++ }).where(eq(categories.id, c.id));

    if (opts.archiveExamples) {
      // categorias de exemplo que ficaram vazias saem do cardápio
      const now2 = await tx.select({ id: products.id, categoryId: products.categoryId }).from(products).where(eq(products.active, true));
      for (const c of cats) {
        if (EXAMPLE_CATEGORIES.map(norm).includes(norm(c.name)) && !OFFICIAL_MENU.some((oc) => norm(oc.name) === norm(c.name)) && !now2.some((p) => p.categoryId === c.id)) {
          await tx.update(categories).set({ active: false }).where(eq(categories.id, c.id));
        }
      }
    }
    // bairros e taxas de entrega: atualiza a taxa pelo nome (mantém repasse e previsão), cria os que faltam
    const nbs = await tx.select().from(neighborhoods);
    for (const on of OFFICIAL_NEIGHBORHOODS) {
      const ex = nbs.find((n) => norm(n.name) === norm(on.name));
      if (ex) await tx.update(neighborhoods).set({ name: on.name, feeCents: on.feeCents, active: true }).where(eq(neighborhoods.id, ex.id));
      else await tx.insert(neighborhoods).values({ name: on.name, feeCents: on.feeCents });
    }
    if (opts.archiveExamples) {
      for (const n of nbs) {
        if (EXAMPLE_NEIGHBORHOODS.map(norm).includes(norm(n.name)) && !OFFICIAL_NEIGHBORHOODS.some((o) => norm(o.name) === norm(n.name))) {
          await tx.update(neighborhoods).set({ active: false }).where(eq(neighborhoods.id, n.id));
        }
      }
    }
    res.neighborhoods = OFFICIAL_NEIGHBORHOODS.length;

    if (opts.updateStore) {
      await updateSettings(tx, OFFICIAL_STORE, ctx.actor.userId);
      res.storeUpdated = true;
    }
    await updateSettings(tx, { officialMenuVersion: OFFICIAL_MENU_VERSION }, ctx.actor.userId);
    const after = await tx.select({ name: products.name }).from(products).where(eq(products.active, true));
    res.kept = after.map((p) => p.name).filter((n) => !official.has(norm(n))).sort();
    await audit(tx, ctx.actor, 'menu.import_official', 'menu', OFFICIAL_MENU_VERSION, {
      created: res.created.length, updated: res.updated.length, archived: res.archived, archiveExamples: opts.archiveExamples, storeUpdated: res.storeUpdated,
    });
    emit({ type: 'menu.changed' });
    return res;
  });
}

/**
 * Modo loja: na primeira abertura de uma versão nova do cardápio oficial, importa sozinho (o dono pediu o
 * cardápio já pronto na aba Cardápio). Roda uma única vez por versão; depois disso, o que a loja mudar no
 * cardápio fica como está. Telefone/endereço só entram se ainda forem os de exemplo ou vazios.
 */
export async function autoImportOfficialMenu(deps: Deps): Promise<OfficialImportResult | null> {
  const s = await getSettings(deps.db);
  if (s.officialMenuVersion === OFFICIAL_MENU_VERSION) return null;
  const [admin] = await deps.db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.active, true))).limit(1);
  if (!admin) return null;
  const exampleStore = !s.storePhone.trim() || s.storePhone.startsWith('(11) 9000') || !s.storeAddress.trim() || /demonstrativo/i.test(s.storeAddress);
  return importOfficialMenu({ ...deps, actor: { userId: admin.id, role: 'admin', name: admin.name } }, { archiveExamples: true, updateStore: exampleStore });
}

export const ADDONS_GROUP = 'Acréscimos';

/** Acréscimos pagos (aparecem em verde ao escolher o lanche): lista atual e categorias onde estão. */
export async function getAddons(db: DbOrTx) {
  const [g] = await db.select().from(optionGroups).where(and(eq(optionGroups.active, true), eq(optionGroups.name, ADDONS_GROUP)));
  if (!g) return { options: [] as { id: string; name: string; priceCents: number }[], categoryIds: [] as string[] };
  const opts = await db.select().from(options).where(and(eq(options.groupId, g.id), eq(options.active, true))).orderBy(asc(options.sort));
  const linked = await db
    .selectDistinct({ categoryId: products.categoryId })
    .from(productOptionGroups)
    .innerJoin(products, eq(products.id, productOptionGroups.productId))
    .where(and(eq(productOptionGroups.groupId, g.id), eq(products.active, true)));
  return { options: opts.map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents })), categoryIds: linked.map((l) => l.categoryId) };
}

/**
 * Salva os acréscimos e coloca o grupo em TODOS os produtos das categorias escolhidas (ex.: Hambúrgueres),
 * antes do "Retirar ingredientes". Produtos de categorias desmarcadas deixam de ter o grupo.
 */
export async function saveAddons(ctx: Ctx, input: { options: { id?: string; name: string; priceCents: number }[]; categoryIds: string[] }) {
  requirePerm(ctx.actor, 'menu.manage');
  for (const o of input.options) {
    if (!o.name.trim()) throw badRequest('Informe o nome de cada acréscimo');
    if (!Number.isSafeInteger(o.priceCents) || o.priceCents <= 0) throw badRequest(`Informe o preço de “${o.name}”`);
  }
  return inTx(ctx, async (tx, emit) => {
    let [g] = await tx.select().from(optionGroups).where(and(eq(optionGroups.active, true), eq(optionGroups.name, ADDONS_GROUP)));
    if (!g) [g] = await tx.insert(optionGroups).values({ name: ADDONS_GROUP, minSelect: 0, maxSelect: 0, sort: 1 }).returning();
    const cur = await tx.select().from(options).where(eq(options.groupId, g!.id));
    const keep = new Set<string>();
    for (const [i, o] of input.options.entries()) {
      const ex = cur.find((c) => (o.id && c.id === o.id) || norm(c.name) === norm(o.name));
      if (ex) {
        await tx.update(options).set({ name: o.name.trim(), priceCents: o.priceCents, active: true, sort: i }).where(eq(options.id, ex.id));
        keep.add(ex.id);
      } else {
        const [n] = await tx.insert(options).values({ groupId: g!.id, name: o.name.trim(), priceCents: o.priceCents, sort: i }).returning();
        keep.add(n!.id);
      }
    }
    for (const c of cur) if (!keep.has(c.id)) await tx.update(options).set({ active: false }).where(eq(options.id, c.id));
    // vínculo com os produtos
    const prods = await tx.select({ id: products.id, categoryId: products.categoryId }).from(products).where(eq(products.active, true));
    const want = new Set(input.categoryIds);
    const links = await tx.select().from(productOptionGroups).where(eq(productOptionGroups.groupId, g!.id));
    for (const p of prods) {
      const has = links.some((l) => l.productId === p.id);
      if (want.has(p.categoryId) && !has) await tx.insert(productOptionGroups).values({ productId: p.id, groupId: g!.id, sort: -1 });
      if (!want.has(p.categoryId) && has) await tx.delete(productOptionGroups).where(and(eq(productOptionGroups.productId, p.id), eq(productOptionGroups.groupId, g!.id)));
    }
    await audit(tx, ctx.actor, 'menu.addons.save', 'option_group', g!.id, { options: input.options.map((o) => ({ name: o.name, priceCents: o.priceCents })), categoryIds: input.categoryIds });
    emit({ type: 'menu.changed' });
    return getAddons(tx);
  });
}
