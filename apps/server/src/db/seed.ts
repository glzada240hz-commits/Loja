import { sql } from 'drizzle-orm';
import type { Db } from './index.js';
import * as s from './schema.js';
import { hashPassword } from '../lib/crypto.js';

export interface SeedOptions {
  adminPassword: string;
  /** cria usuários demonstrativos de cada perfil (senha "demo1234") — NÃO use em produção */
  demoUsers: boolean;
  /** cria cardápio, bairros, insumos e entregadores demonstrativos */
  demoData: boolean;
}

export const DEMO_PASSWORD = 'demo1234';

/** Popula um banco vazio. Não faz nada se já houver usuários. */
export async function seed(db: Db, opts: SeedOptions) {
  const count = ((await db.execute(sql`select count(*)::int as count from users`)).rows[0] as { count: number }).count;
  if (count > 0) return { skipped: true };

  return db.transaction(async (tx) => {
    const [admin] = await tx
      .insert(s.users)
      .values({ name: 'Administrador', username: 'admin', role: 'admin', passwordHash: await hashPassword(opts.adminPassword) })
      .returning();
    const userIds: Record<string, string> = { admin: admin!.id };
    if (opts.demoUsers) {
      const demoHash = await hashPassword(DEMO_PASSWORD);
      for (const [username, name, role] of [
        ['gerente', 'Gerente Demo', 'manager'],
        ['caixa', 'Caixa Demo', 'cashier'],
        ['cozinha', 'Cozinha Demo', 'kitchen'],
        ['moto1', 'Entregador 1 (demo)', 'courier'],
        ['moto2', 'Entregador 2 (demo)', 'courier'],
      ] as const) {
        const [u] = await tx.insert(s.users).values({ name, username, role, passwordHash: demoHash }).returning();
        userIds[username] = u!.id;
      }
    }
    if (!opts.demoData) return { skipped: false };

    await tx.insert(s.settings).values({
      key: 'store',
      value: {
        storeName: 'Bar do Guto',
        storePhone: '(11) 90000-0000',
        storeAddress: 'Endereço demonstrativo — configure em Ajustes',
        tables: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      },
    });

    // ---------- bairros (valores demonstrativos) ----------
    await tx.insert(s.neighborhoods).values([
      { name: 'Centro', feeCents: 500, courierFeeCents: 400, etaMinutes: 40 },
      { name: 'Vila Nova', feeCents: 700, courierFeeCents: 500, etaMinutes: 45 },
      { name: 'Jardim das Flores', feeCents: 900, courierFeeCents: 600, minOrderCents: 3000, etaMinutes: 55 },
    ]);

    // ---------- entregadores ----------
    await tx.insert(s.couriers).values([
      { name: 'Entregador 1 (demo)', defaultFeeCents: 500, userId: userIds.moto1 ?? null, phone: '5511900000001' },
      { name: 'Entregador 2 (demo)', defaultFeeCents: 500, userId: userIds.moto2 ?? null, phone: '5511900000002' },
    ]);

    // ---------- insumos (custos demonstrativos) ----------
    const stockDefs = [
      ['Pão de hambúrguer', 'un', '50', '20', '120'],
      ['Hambúrguer bovino 120g', 'un', '60', '20', '450'],
      ['Queijo mussarela (fatia)', 'fatia', '200', '50', '60'],
      ['Ovo', 'un', '90', '30', '70'],
      ['Bacon', 'g', '3000', '800', '6'],
      ['Cheddar cremoso', 'g', '2000', '500', '4'],
      ['Picanha (bife)', 'un', '20', '8', '1200'],
      ['Batata congelada', 'g', '10000', '3000', '2.2'],
      ['Refrigerante lata', 'un', '48', '24', '320'],
    ] as const;
    const stock: Record<string, string> = {};
    for (const [name, unit, qty, min, cost] of stockDefs) {
      const [r] = await tx.insert(s.stockItems).values({ name, unit, quantity: qty, minQuantity: min, unitCostCents: cost }).returning();
      stock[name] = r!.id;
      await tx.insert(s.stockMovements).values({ stockItemId: r!.id, type: 'entry', quantity: qty, reason: 'Estoque inicial (demonstração)', createdBy: admin!.id });
    }

    // ---------- cardápio ----------
    const [lanches] = await tx.insert(s.categories).values({ name: 'Lanches', sort: 1 }).returning();
    const [porcoes] = await tx.insert(s.categories).values({ name: 'Porções', sort: 2 }).returning();
    const [combos] = await tx.insert(s.categories).values({ name: 'Combos', sort: 3 }).returning();
    const [bebidas] = await tx.insert(s.categories).values({ name: 'Bebidas', sort: 4, sendToKitchen: false }).returning();

    const [adicionais] = await tx.insert(s.optionGroups).values({ name: 'Adicionais', minSelect: 0, maxSelect: 5, sort: 1 }).returning();
    const [cheddar] = await tx.insert(s.options).values({ groupId: adicionais!.id, name: 'Cheddar', priceCents: 400, costCents: 120, sort: 1 }).returning();
    const [baconOpt] = await tx.insert(s.options).values({ groupId: adicionais!.id, name: 'Bacon extra', priceCents: 500, costCents: 180, sort: 2 }).returning();
    const [ovoOpt] = await tx.insert(s.options).values({ groupId: adicionais!.id, name: 'Ovo extra', priceCents: 300, costCents: 70, sort: 3 }).returning();
    const [retirar] = await tx.insert(s.optionGroups).values({ name: 'Retirar ingredientes', minSelect: 0, maxSelect: 0, sort: 2 }).returning();
    for (const [i, name] of ['Sem cebola', 'Sem tomate', 'Sem alface', 'Sem maionese'].entries()) {
      await tx.insert(s.options).values({ groupId: retirar!.id, name, priceCents: 0, costCents: 0, sort: i });
    }
    await tx.insert(s.recipeItems).values([
      { optionId: cheddar!.id, stockItemId: stock['Cheddar cremoso']!, quantity: '30' },
      { optionId: baconOpt!.id, stockItemId: stock['Bacon']!, quantity: '30' },
      { optionId: ovoOpt!.id, stockItemId: stock['Ovo']!, quantity: '1' },
    ]);

    type Rec = [string, string][];
    const base: Rec = [
      ['Pão de hambúrguer', '1'],
      ['Hambúrguer bovino 120g', '1'],
      ['Queijo mussarela (fatia)', '1'],
    ];
    // Preços fornecidos pelo cliente (dados demonstrativos sujeitos a revisão). Custos: estimativa fictícia.
    const lanchesDefs: [string, string, number, number, string, Rec][] = [
      ['1', 'X-Burguer', 1350, 550, 'Pão, hambúrguer, queijo, alface, tomate e maionese.', base],
      ['2', 'X-Egg Burguer', 1550, 640, 'X-Burguer com ovo.', [...base, ['Ovo', '1']]],
      ['3', 'X-Bacon', 1890, 780, 'X-Burguer com bacon.', [...base, ['Bacon', '40']]],
      ['4', 'X-Egg Bacon', 1890, 850, 'X-Burguer com ovo e bacon.', [...base, ['Ovo', '1'], ['Bacon', '40']]],
      ['5', 'X-Guto', 1990, 900, 'Receita da casa. (descrição demonstrativa)', [...base, ['Ovo', '1'], ['Bacon', '30'], ['Cheddar cremoso', '20']]],
      ['6', 'X-Tudo', 2190, 1050, 'Hambúrguer, queijo, ovo, bacon, presunto, alface e tomate.', [...base, ['Ovo', '1'], ['Bacon', '40']]],
      ['7', 'X-Picanha', 2590, 1500, 'Pão, bife de picanha, queijo e salada.', [['Pão de hambúrguer', '1'], ['Picanha (bife)', '1'], ['Queijo mussarela (fatia)', '1']]],
      ['8', 'X-Cabuloso', 2390, 1150, 'Duplo hambúrguer, bacon, cheddar e ovo. (descrição demonstrativa)', [
        ['Pão de hambúrguer', '1'], ['Hambúrguer bovino 120g', '2'], ['Bacon', '40'], ['Cheddar cremoso', '30'], ['Ovo', '1'],
      ]],
    ];
    const variantByName: Record<string, string> = {};
    let sort = 0;
    for (const [code, name, price, cost, desc, rec] of lanchesDefs) {
      const [p] = await tx.insert(s.products).values({ categoryId: lanches!.id, code, name, description: desc, sort: sort++ }).returning();
      const [v] = await tx.insert(s.productVariants).values({ productId: p!.id, name: 'Único', priceCents: price, costCents: cost }).returning();
      variantByName[name] = v!.id;
      await tx.insert(s.productOptionGroups).values([
        { productId: p!.id, groupId: adicionais!.id, sort: 0 },
        { productId: p!.id, groupId: retirar!.id, sort: 1 },
      ]);
      for (const [item, q] of rec) await tx.insert(s.recipeItems).values({ variantId: v!.id, stockItemId: stock[item]!, quantity: q });
    }

    const [batata] = await tx.insert(s.products).values({ categoryId: porcoes!.id, code: '20', name: 'Batata frita', description: 'Porção de batata frita.', sort: 1 }).returning();
    const [batataV] = await tx.insert(s.productVariants).values({ productId: batata!.id, name: 'Único', priceCents: 2290, costCents: 800 }).returning();
    await tx.insert(s.recipeItems).values({ variantId: batataV!.id, stockItemId: stock['Batata congelada']!, quantity: '400' });
    await tx.insert(s.productOptionGroups).values({ productId: batata!.id, groupId: adicionais!.id, sort: 0 });
    variantByName['Batata frita'] = batataV!.id;

    const [batataCB] = await tx.insert(s.products).values({ categoryId: porcoes!.id, code: '21', name: 'Batata com cheddar e bacon', description: 'Porção de batata com cheddar e bacon.', sort: 2 }).returning();
    const [batataCBV] = await tx.insert(s.productVariants).values({ productId: batataCB!.id, name: 'Único', priceCents: 4090, costCents: 1600 }).returning();
    await tx.insert(s.recipeItems).values([
      { variantId: batataCBV!.id, stockItemId: stock['Batata congelada']!, quantity: '500' },
      { variantId: batataCBV!.id, stockItemId: stock['Cheddar cremoso']!, quantity: '120' },
      { variantId: batataCBV!.id, stockItemId: stock['Bacon']!, quantity: '100' },
    ]);

    const [refri] = await tx
      .insert(s.products)
      .values({ categoryId: bebidas!.id, code: '30', name: 'Refrigerante lata', description: 'PREÇO DEMONSTRATIVO — revise antes do uso.', sort: 1 })
      .returning();
    const [refriV] = await tx.insert(s.productVariants).values({ productId: refri!.id, name: 'Único', priceCents: 600, costCents: 320 }).returning();
    await tx.insert(s.recipeItems).values({ variantId: refriV!.id, stockItemId: stock['Refrigerante lata']!, quantity: '1' });

    const [combo] = await tx
      .insert(s.products)
      .values({ categoryId: combos!.id, code: '40', name: 'Combo X-Burguer + Batata + Refri', kind: 'combo', description: 'EXEMPLO DE COMBO — preço demonstrativo, revise antes do uso.', sort: 1 })
      .returning();
    await tx.insert(s.productVariants).values({ productId: combo!.id, name: 'Único', priceCents: 3990, costCents: 1670 });
    await tx.insert(s.comboItems).values([
      { comboProductId: combo!.id, componentVariantId: variantByName['X-Burguer']!, quantity: 1 },
      { comboProductId: combo!.id, componentVariantId: batataV!.id, quantity: 1 },
      { comboProductId: combo!.id, componentVariantId: refriV!.id, quantity: 1 },
    ]);
    await tx.insert(s.productOptionGroups).values({ productId: combo!.id, groupId: retirar!.id, sort: 0 });

    await tx.insert(s.quickReplies).values([
      { title: 'Cardápio', body: 'Confira nosso cardápio e peça por aqui: {link do cardápio}', sort: 1 },
      { title: 'Tempo de entrega', body: 'No momento estamos entregando em cerca de 50 minutos.', sort: 2 },
      { title: 'Chave Pix', body: 'Nossa chave Pix é: (configure). Após pagar, envie o comprovante — o pedido segue após conferirmos o recebimento.', sort: 3 },
    ]);
    return { skipped: false };
  });
}

/** Apaga TODOS os dados (somente para testes). */
export async function truncateAll(db: Db) {
  const tables = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`)).rows as { tablename: string }[];
  if (!tables.length) return;
  await db.execute(sql.raw(`truncate ${tables.map((t) => `"${t.tablename}"`).join(', ')} restart identity cascade`));
}

