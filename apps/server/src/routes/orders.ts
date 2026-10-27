import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm } from '../lib/context.js';
import * as svc from '../services/orders.js';
import { addressInput, cents, customerInput, discountInput, idem, idParam, itemInput, orderType, paymentMethod, supervisor, uuid } from './schemas.js';

const version = z.number().int().min(1);

export async function orderRoutes(app: FastifyInstance) {
  app.get('/api/orders', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'orders.view');
    const q = z
      .object({
        dayId: uuid.optional(),
        status: z.string().optional(),
        type: orderType.optional(),
        q: z.string().max(100).optional(),
        receivable: z.enum(['1', '0']).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);
    const status = q.status?.split(',').filter(Boolean) as svc.OrderFilters['status'];
    return svc.listOrders(ctx.db, { businessDayId: q.dayId, status, type: q.type, q: q.q, receivable: q.receivable === '1', limit: q.limit });
  });

  app.get('/api/orders/:id', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'orders.view');
    return svc.getOrder(ctx.db, idParam.parse(req.params).id);
  });

  app.post('/api/orders', async (req) => {
    const ctx = app.ctx(req);
    const body = z
      .object({
        type: orderType,
        tableLabel: z.string().max(20).nullish(),
        tabKind: z.enum(['table', 'tab']).optional(),
        customer: customerInput,
        address: addressInput,
        notes: z.string().max(500).nullish(),
        items: z.array(itemInput).min(1).max(100),
        discount: discountInput,
        deliveryFeeCents: cents.nullish(),
        etaMinutes: z.number().int().min(1).max(600).nullish(),
        send: z.boolean().optional(),
        confirmDuplicate: z.boolean().optional(),
        waOptIn: z.boolean().optional(),
        paymentIntent: paymentMethod.nullish(),
        changeForCents: cents.nullish(),
        supervisor,
      })
      .parse(req.body);
    const { supervisor: sup, ...input } = body;
    const r = await svc.createOrder(ctx, { ...input, source: 'pos' }, { idem: idem(req, 'orders.create', input), supervisor: sup });
    return svc.getOrder(ctx.db, r.id);
  });

  app.patch('/api/orders/:id', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        version,
        type: orderType.optional(),
        tableLabel: z.string().max(20).nullish(),
        customer: customerInput,
        address: addressInput,
        notes: z.string().max(500).nullish(),
        etaMinutes: z.number().int().min(1).max(600).nullish(),
        deliveryFeeCents: cents.nullish(),
        supervisor,
      })
      .parse(req.body);
    const { version: v, supervisor: sup, ...patch } = body;
    await svc.updateHeader(ctx, id, v, patch, sup);
    return svc.getOrder(ctx.db, id);
  });

  app.post('/api/orders/:id/items', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ version: version.optional(), items: z.array(itemInput).min(1).max(100), send: z.boolean().optional() }).parse(req.body);
    // a chave de repetição considera só os itens (não a versão): um reenvio após queda de conexão é reconhecido
    const r = await svc.addItems(ctx, id, body.version, body.items, body.send ?? true, idem(req, `orders.items:${id}`, { items: body.items, send: body.send ?? true }));
    return { ...(await svc.getOrder(ctx.db, id)), sentTicketId: r.ticketId };
  });

  app.post('/api/orders/:id/send', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ version }).parse(req.body);
    await svc.sendPending(ctx, id, body.version);
    return svc.getOrder(ctx.db, id);
  });

  app.patch('/api/orders/:id/items/:itemId', async (req) => {
    const ctx = app.ctx(req);
    const p = z.object({ id: uuid, itemId: uuid }).parse(req.params);
    const body = z.object({ version, quantity: z.number().int().min(1).max(99).optional(), notes: z.string().max(300).nullish() }).parse(req.body);
    await svc.updateItem(ctx, p.id, p.itemId, body.version, { quantity: body.quantity, notes: body.notes });
    return svc.getOrder(ctx.db, p.id);
  });

  app.post('/api/orders/:id/items/:itemId/cancel', async (req) => {
    const ctx = app.ctx(req);
    const p = z.object({ id: uuid, itemId: uuid }).parse(req.params);
    const body = z.object({ version, reason: z.string().min(1).max(200), stockMode: z.enum(['auto', 'return', 'loss']).optional(), supervisor }).parse(req.body);
    await svc.cancelItem(ctx, p.id, p.itemId, body.version, { reason: body.reason, stockMode: body.stockMode }, body.supervisor);
    return svc.getOrder(ctx.db, p.id);
  });

  app.put('/api/orders/:id/discount', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ version, discount: discountInput, supervisor }).parse(req.body);
    await svc.setDiscount(ctx, id, body.version, body.discount ?? null, body.supervisor);
    return svc.getOrder(ctx.db, id);
  });

  app.post('/api/orders/:id/accept', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ version, etaMinutes: z.number().int().min(1).max(600).nullish() }).parse(req.body);
    await svc.acceptOrder(ctx, id, body.version, body.etaMinutes);
    return svc.getOrder(ctx.db, id);
  });

  app.post('/api/orders/:id/payments', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        method: paymentMethod,
        amountCents: cents.refine((v) => v > 0, 'deve ser positivo'),
        tenderedCents: cents.nullish(),
        payerLabel: z.string().max(60).nullish(),
        note: z.string().max(200).nullish(),
      })
      .parse(req.body);
    const result = await svc.addPayment(ctx, id, body, idem(req, `payments.create:${id}`, body));
    return { result, order: await svc.getOrder(ctx.db, id) };
  });

  app.post('/api/payments/:id/refund', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(200), supervisor }).parse(req.body);
    const r = await svc.refundPayment(ctx, id, body.reason, body.supervisor);
    return svc.getOrder(ctx.db, r.id);
  });

  app.get('/api/orders/:id/split', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const { ways } = z.object({ ways: z.coerce.number().int().min(1).max(50) }).parse(req.query);
    return svc.splitSuggestion(ctx.db, id, ways);
  });

  app.post('/api/orders/:id/cancel', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ version, reason: z.string().min(3).max(300), refundPayments: z.boolean().optional(), stockMode: z.enum(['auto', 'return', 'loss']).optional(), supervisor })
      .parse(req.body);
    await svc.cancelOrder(ctx, id, body.version, body, body.supervisor);
    return svc.getOrder(ctx.db, id);
  });

  app.post('/api/orders/:id/request-bill', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    await svc.requestBill(ctx, id);
    return svc.getOrder(ctx.db, id);
  });

  app.post('/api/kitchen/tickets/:id/served', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    await svc.markServed(ctx, id);
    return { ok: true };
  });

  app.post('/api/orders/:id/handover', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    await svc.markHandedOver(ctx, id);
    return svc.getOrder(ctx.db, id);
  });

  app.post('/api/orders/:id/close', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ version, receivable: z.boolean().optional(), supervisor }).parse(req.body);
    await svc.closeOrder(ctx, id, body.version, { receivable: body.receivable }, body.supervisor);
    return svc.getOrder(ctx.db, id);
  });

  app.post('/api/orders/:id/reopen', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().min(3).max(300), supervisor }).parse(req.body);
    await svc.reopenOrder(ctx, id, body.reason, body.supervisor);
    return svc.getOrder(ctx.db, id);
  });
}
