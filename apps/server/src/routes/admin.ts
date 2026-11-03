import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { orders } from '../db/schema.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { imageExt } from './menu.js';
import { queueTestPrint, readPrinterInfo } from '../services/kitchenPrintAgent.js';
import { tunnelRef } from '../services/publicGateway.js';
import { ROLES } from '@guto/core';
import { requirePerm } from '../lib/context.js';
import * as admin from '../services/admin.js';
import { exportCsv, salesReport, validateRange } from '../services/reports.js';
import { getSettings, storeSettingsSchema, updateSettings } from '../services/settings.js';
import { audit } from '../lib/audit.js';
import { cents, idParam, uuid } from './schemas.js';

export async function adminRoutes(app: FastifyInstance) {
  // ---------- configurações ----------
  app.get('/api/settings', async (req) => {
    app.ctx(req);
    return getSettings(app.deps.db);
  });
  app.put('/api/settings', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'settings.manage');
    const patch = storeSettingsSchema.partial().parse(req.body);
    delete patch.logoUrl; // a logo só muda pelo envio/remoção próprios (evita apagar com formulário antigo)
    delete patch.officialMenuVersion; // controle interno da importação do cardápio
    const s = await updateSettings(ctx.db, patch, ctx.actor.userId);
    await audit(ctx.db, ctx.actor, 'settings.update', 'settings', 'store', patch);
    ctx.bus.publish({ type: 'menu.changed' });
    return s;
  });

  // logo da loja: aparece no app (menu, login, cardápio digital) e no topo da nota não fiscal
  app.post('/api/settings/logo', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'settings.manage');
    const file = await req.file();
    if (!file) throw badRequest('Envie a imagem da logo');
    const buf = await file.toBuffer();
    const ext = imageExt(buf);
    if (!ext) throw badRequest('Formato não suportado (use PNG, JPG ou WebP)');
    const name = `logo-${randomToken(8)}${ext}`;
    await fs.writeFile(path.join(path.resolve(app.deps.config.UPLOAD_DIR), name), buf);
    const s = await updateSettings(ctx.db, { logoUrl: '/uploads/' + name }, ctx.actor.userId);
    await audit(ctx.db, ctx.actor, 'settings.logo', 'settings', 'store', { logoUrl: s.logoUrl });
    ctx.bus.publish({ type: 'menu.changed' });
    return s;
  });
  app.delete('/api/settings/logo', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'settings.manage');
    const s = await updateSettings(ctx.db, { logoUrl: '' }, ctx.actor.userId);
    await audit(ctx.db, ctx.actor, 'settings.logo', 'settings', 'store', { logoUrl: '' });
    return s;
  });

  // endereços deste computador na rede da loja (QR para os celulares dos atendentes e o tablet da cozinha)
  app.get('/api/system/addresses', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'cash.open');
    const port = app.deps.config.PORT;
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal && !/^169\.254\./.test(i.address))
      .map((i) => i.address)
      // redes de casa/loja primeiro (192.168.x, 10.x); adaptadores virtuais por último
      .sort((a, b) => Number(!a.startsWith('192.168.')) - Number(!b.startsWith('192.168.')));
    const pub = app.deps.config.PUBLIC_BASE_URL;
    const urls = [...new Set([...lan.map((ip) => `http://${ip}:${port}`), ...(pub && !/localhost|127\.0\.0\.1/.test(pub) ? [pub.replace(/\/$/, '')] : [])])];
    return { urls };
  });

  // impressora da cozinha (duas impressoras: a via da cozinha sai pelo BarDoGuto.exe na impressora escolhida)
  app.get('/api/system/printers', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'cash.open');
    const s = await getSettings(ctx.db);
    return { enabled: !!app.deps.config.PRINT_DIR, kitchenPrinter: s.kitchenPrinterName, ...readPrinterInfo(app.deps.config.PRINT_DIR) };
  });
  app.post('/api/system/kitchen-printer', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'cash.open');
    const body = z.object({ name: z.string().max(200) }).parse(req.body);
    const s = await updateSettings(ctx.db, { kitchenPrinterName: body.name.trim() }, ctx.actor.userId);
    await audit(ctx.db, ctx.actor, 'settings.kitchen_printer', 'settings', 'store', { name: s.kitchenPrinterName });
    ctx.bus.publish({ type: 'menu.changed' }); // aparelhos atualizam (e a impressão pelo navegador desliga)
    return { kitchenPrinter: s.kitchenPrinterName };
  });
  app.post('/api/system/printers/test', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'cash.open');
    const dir = app.deps.config.PRINT_DIR;
    const s = await getSettings(ctx.db);
    if (!dir) throw badRequest('Impressão por impressora escolhida só funciona no aplicativo da loja (Windows)');
    if (!s.kitchenPrinterName) throw badRequest('Escolha a impressora da cozinha primeiro');
    queueTestPrint(dir, s.kitchenPrinterName, s.printWidth);
    return { ok: true };
  });

  // cardápio digital na internet (túnel do computador da loja)
  app.get('/api/system/public-link', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'cash.open');
    const s = await getSettings(ctx.db);
    const t = tunnelRef.current?.state;
    return { supported: !!t, available: t?.available ?? false, enabled: s.publicMenuOnline, status: t?.status ?? 'off', url: t?.url ?? null, menuUrl: t?.url ? `${t.url}/c` : null, error: t?.error ?? null, since: t?.since ?? null };
  });

  // ---------- usuários ----------
  app.get('/api/users', async (req) => admin.listUsers(app.ctx(req)));
  app.post('/api/users', async (req) => {
    const body = z
      .object({ id: uuid.optional(), name: z.string().min(1).max(80), username: z.string().min(1).max(60), role: z.enum(ROLES), active: z.boolean().optional(), password: z.string().max(200).optional() })
      .parse(req.body);
    return admin.saveUser(app.ctx(req), body);
  });

  // ---------- bairros ----------
  app.get('/api/neighborhoods', async (req) => {
    app.ctx(req);
    return admin.listNeighborhoods(app.deps.db);
  });
  // ruas já usadas em entregas do bairro (sugestão ao digitar o endereço)
  app.get('/api/neighborhoods/:id/streets', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'orders.create');
    const { id } = idParam.parse(req.params);
    const rows = await ctx.db
      .select({ street: orders.addrStreet, n: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.neighborhoodId, id), isNotNull(orders.addrStreet)))
      .groupBy(orders.addrStreet)
      .orderBy(desc(sql`count(*)`))
      .limit(80);
    return rows.map((r) => r.street!).filter(Boolean);
  });
  app.post('/api/neighborhoods', async (req) => {
    const body = z
      .object({
        id: uuid.optional(),
        name: z.string().min(1).max(80),
        feeCents: cents,
        courierFeeCents: cents.nullish(),
        minOrderCents: cents.optional(),
        etaMinutes: z.number().int().min(1).max(600).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    return admin.saveNeighborhood(app.ctx(req), body);
  });

  // ---------- clientes ----------
  app.get('/api/customers', async (req) => {
    const { q, phone } = z.object({ q: z.string().max(100).optional(), phone: z.string().max(30).optional() }).parse(req.query);
    const ctx = app.ctx(req);
    if (phone) return admin.customerByPhone(ctx, phone);
    return admin.searchCustomers(ctx, q ?? '');
  });
  app.get('/api/customers/:id', async (req) => admin.getCustomer(app.ctx(req), idParam.parse(req.params).id));
  app.patch('/api/customers/:id', async (req) => {
    const body = z.object({ name: z.string().max(120).optional(), phone: z.string().max(30).nullish(), notes: z.string().max(500).nullish() }).parse(req.body);
    return admin.updateCustomer(app.ctx(req), idParam.parse(req.params).id, body);
  });
  app.delete('/api/customers/:id/addresses/:addressId', async (req) => {
    const p = z.object({ id: uuid, addressId: uuid }).parse(req.params);
    await admin.deleteAddress(app.ctx(req), p.id, p.addressId);
    return { ok: true };
  });
  app.post('/api/customers/:id/anonymize', async (req) => {
    const body = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
    return admin.anonymizeCustomer(app.ctx(req), idParam.parse(req.params).id, body.reason);
  });

  // ---------- despesas ----------
  app.get('/api/expenses', async (req) => {
    const r = validateRange(z.object({ from: z.string(), to: z.string() }).parse(req.query));
    return admin.listExpenses(app.ctx(req), r.from, r.to);
  });
  app.post('/api/expenses', async (req) => {
    const body = z
      .object({ date: z.string().optional(), category: z.string().min(1).max(60), description: z.string().min(1).max(200), amountCents: cents, paidFromCash: z.boolean() })
      .parse(req.body);
    return admin.createExpense(app.ctx(req), body);
  });
  app.delete('/api/expenses/:id', async (req) => {
    await admin.deleteExpense(app.ctx(req), idParam.parse(req.params).id);
    return { ok: true };
  });

  // ---------- relatórios ----------
  app.get('/api/reports/sales', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'reports.view');
    return salesReport(ctx.db, validateRange(z.object({ from: z.string(), to: z.string() }).parse(req.query)));
  });
  app.get('/api/reports/export', async (req, reply) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'data.export');
    const q = z.object({ kind: z.string(), from: z.string(), to: z.string() }).parse(req.query);
    const { filename, csv } = await exportCsv(ctx.db, q.kind, validateRange(q));
    await audit(ctx.db, ctx.actor, 'data.export', 'report', q.kind, { from: q.from, to: q.to });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${filename}"`).send(csv);
  });

  app.get('/api/audit', async (req) => {
    const q = z.object({ entity: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }).parse(req.query);
    return admin.listAudit(app.ctx(req), q);
  });
}
