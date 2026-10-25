import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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
    const s = await updateSettings(ctx.db, patch, ctx.actor.userId);
    await audit(ctx.db, ctx.actor, 'settings.update', 'settings', 'store', patch);
    ctx.bus.publish({ type: 'menu.changed' });
    return s;
  });

  // ---------- usuários ----------
  app.get('/api/users', async (req) => admin.listUsers(app.ctx(req)));
  app.post('/api/users', async (req) => {
    const body = z
      .object({ id: uuid.optional(), name: z.string().min(1).max(80), username: z.string().min(3).max(40), role: z.enum(ROLES), active: z.boolean().optional(), password: z.string().max(200).optional() })
      .parse(req.body);
    return admin.saveUser(app.ctx(req), body);
  });

  // ---------- bairros ----------
  app.get('/api/neighborhoods', async (req) => {
    app.ctx(req);
    return admin.listNeighborhoods(app.deps.db);
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
