import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requirePerm } from '../lib/context.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { can } from '@guto/core';
import * as menu from '../services/menu.js';
import * as stock from '../services/stock.js';
import { cents, idParam, uuid } from './schemas.js';

const qtyStr = z.string().regex(/^\d+(\.\d{1,3})?$/, 'quantidade inválida (use ponto, até 3 casas)');

function imageExt(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}

export async function menuRoutes(app: FastifyInstance) {
  app.get('/api/menu', async (req) => {
    const ctx = app.ctx(req);
    if (!(['orders.view', 'menu.manage', 'kitchen.view'] as const).some((p) => can(ctx.actor.role, p))) throw forbidden();
    return menu.getMenu(ctx.db);
  });

  app.post('/api/menu/categories', async (req) => {
    const body = z.object({ id: uuid.optional(), name: z.string().min(1).max(60), sort: z.number().int().optional(), sendToKitchen: z.boolean().optional(), active: z.boolean().optional() }).parse(req.body);
    return menu.saveCategory(app.ctx(req), body);
  });

  app.post('/api/menu/products', async (req) => {
    const body = z
      .object({
        id: uuid.optional(),
        categoryId: uuid,
        code: z.string().max(10).nullish(),
        name: z.string().min(1).max(80),
        description: z.string().max(400).nullish(),
        kind: z.enum(['simple', 'combo']).optional(),
        available: z.boolean().optional(),
        showOnline: z.boolean().optional(),
        sort: z.number().int().optional(),
        variants: z.array(z.object({ id: uuid.optional(), name: z.string().max(40), priceCents: cents, costCents: cents.nullish(), available: z.boolean().optional() })).min(1).max(10),
        groupIds: z.array(uuid).max(20).optional(),
        combo: z.array(z.object({ variantId: uuid, quantity: z.number().int().min(1).max(20) })).max(20).optional(),
      })
      .parse(req.body);
    return menu.saveProduct(app.ctx(req), body);
  });

  app.delete('/api/menu/products/:id', async (req) => {
    await menu.archiveProduct(app.ctx(req), idParam.parse(req.params).id);
    return { ok: true };
  });

  app.post('/api/menu/availability', async (req) => {
    const body = z.object({ target: z.enum(['product', 'variant', 'option']), id: uuid, available: z.boolean() }).parse(req.body);
    await menu.setAvailability(app.ctx(req), body.target, body.id, body.available);
    return { ok: true };
  });

  app.post('/api/menu/products/:id/image', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'menu.manage');
    const { id } = idParam.parse(req.params);
    const file = await req.file();
    if (!file) throw badRequest('Envie uma imagem');
    const buf = await file.toBuffer();
    const ext = imageExt(buf);
    if (!ext) throw badRequest('Formato não suportado (use JPG, PNG ou WebP)');
    const name = `${id}-${randomToken(6)}${ext}`;
    await fs.writeFile(path.join(path.resolve(app.deps.config.UPLOAD_DIR), name), buf);
    return menu.setProductImage(ctx, id, '/uploads/' + name);
  });

  app.delete('/api/menu/products/:id/image', async (req) => menu.setProductImage(app.ctx(req), idParam.parse(req.params).id, null));

  app.get('/api/menu/groups', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'menu.manage');
    return menu.listOptionGroups(ctx.db);
  });
  app.post('/api/menu/groups', async (req) => {
    const body = z
      .object({
        id: uuid.optional(),
        name: z.string().min(1).max(60),
        minSelect: z.number().int().min(0).max(20),
        maxSelect: z.number().int().min(0).max(20),
        options: z.array(z.object({ id: uuid.optional(), name: z.string().min(1).max(60), priceCents: cents, costCents: cents.nullish(), available: z.boolean().optional() })).max(50),
      })
      .parse(req.body);
    return menu.saveOptionGroup(app.ctx(req), body);
  });

  app.get('/api/menu/recipes', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'menu.manage');
    const q = z.object({ variantId: uuid.optional(), optionId: uuid.optional() }).parse(req.query);
    const items = await menu.getRecipe(ctx.db, q);
    const cost = q.variantId ? await menu.recipeCost(ctx.db, q.variantId) : null;
    return { items, cost };
  });
  app.put('/api/menu/recipes', async (req) => {
    const body = z
      .object({ variantId: uuid.optional(), optionId: uuid.optional(), items: z.array(z.object({ stockItemId: uuid, quantity: qtyStr })).max(40) })
      .parse(req.body);
    return menu.saveRecipe(app.ctx(req), { variantId: body.variantId, optionId: body.optionId }, body.items);
  });

  // ---------- estoque ----------
  app.get('/api/stock', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'stock.view');
    return stock.listStock(ctx.db);
  });
  app.post('/api/stock', async (req) => {
    const body = z
      .object({
        id: uuid.optional(),
        name: z.string().min(1).max(80),
        unit: z.enum(['un', 'g', 'kg', 'ml', 'l', 'fatia', 'porção']),
        minQuantity: qtyStr,
        unitCostCents: z.string().regex(/^\d+(\.\d{1,4})?$/).nullish(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    return stock.saveStockItem(app.ctx(req), body);
  });
  app.post('/api/stock/movements', async (req) => {
    const body = z
      .object({
        stockItemId: uuid,
        type: z.enum(['entry', 'loss', 'manual_out', 'adjustment']),
        quantity: qtyStr,
        reason: z.string().min(1).max(200),
        unitCostCents: z.string().regex(/^\d+(\.\d{1,4})?$/).nullish(),
      })
      .parse(req.body);
    return stock.manualMovement(app.ctx(req), body);
  });
  app.get('/api/stock/movements', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'stock.view');
    const q = z.object({ stockItemId: uuid.optional() }).parse(req.query);
    return stock.listMovements(ctx.db, q.stockItemId);
  });
}
