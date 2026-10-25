import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DELIVERY_STATUSES, KITCHEN_STATUSES } from '@guto/core';
import { requirePerm } from '../lib/context.js';
import { authorize } from '../services/auth.js';
import { closeDay, currentDay, listDays, openDay } from '../services/businessDay.js';
import { addCashMovement, closeCash, currentCash, getCashView, listCashSessions, openCash } from '../services/cash.js';
import { kitchenQueue, setTicketStatus } from '../services/kitchen.js';
import * as del from '../services/delivery.js';
import { getSettings } from '../services/settings.js';
import { cents, idem, idParam, supervisor, uuid } from './schemas.js';

export async function opsRoutes(app: FastifyInstance) {
  // ---------- dia operacional ----------
  app.get('/api/day', async (req) => {
    const ctx = app.ctx(req);
    const day = await currentDay(ctx.db);
    const cash = await currentCash(ctx.db);
    return { day, cash: cash ? { id: cash.id, openedAt: cash.openedAt, status: cash.status } : null };
  });
  app.get('/api/days', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'orders.view');
    return listDays(ctx.db);
  });
  app.post('/api/day/open', async (req) => {
    const ctx = app.ctx(req);
    const body = z.object({ notes: z.string().max(300).nullish() }).parse(req.body ?? {});
    return openDay(ctx, body.notes ?? undefined);
  });
  app.post('/api/day/close', async (req) => {
    const ctx = app.ctx(req);
    return closeDay(ctx);
  });

  // ---------- caixa ----------
  app.get('/api/cash', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'cash.open');
    const { id } = z.object({ id: uuid.optional() }).parse(req.query);
    return getCashView(ctx, id);
  });
  app.get('/api/cash/sessions', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'reports.view');
    return listCashSessions(ctx.db);
  });
  app.post('/api/cash/open', async (req) => {
    const ctx = app.ctx(req);
    const body = z.object({ openingCents: cents }).parse(req.body);
    return openCash(ctx, body.openingCents);
  });
  app.post('/api/cash/movements', async (req) => {
    const ctx = app.ctx(req);
    const body = z.object({ type: z.enum(['supply', 'withdrawal']), amountCents: cents, reason: z.string().min(1).max(200) }).parse(req.body);
    return addCashMovement(ctx, body, idem(req, 'cash.movement', body));
  });
  app.post('/api/cash/close', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'cash.open');
    const body = z.object({ countedCashCents: cents, justification: z.string().max(500).nullish(), supervisor }).parse(req.body);
    const authorizedBy = await authorize(ctx.db, ctx.actor, 'cash.close', body.supervisor);
    return closeCash(ctx, { countedCashCents: body.countedCashCents, justification: body.justification ?? undefined }, authorizedBy);
  });

  // ---------- cozinha ----------
  app.get('/api/kitchen', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'kitchen.view');
    const s = await getSettings(ctx.db);
    return { lateMinutes: s.kitchenLateMinutes, tickets: await kitchenQueue(ctx.db) };
  });
  app.post('/api/kitchen/tickets/:id/status', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ status: z.enum(KITCHEN_STATUSES) }).parse(req.body);
    return setTicketStatus(ctx, id, body.status);
  });

  // ---------- entregas ----------
  app.get('/api/couriers', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'deliveries.manage');
    const { all } = z.object({ all: z.enum(['1', '0']).optional() }).parse(req.query);
    return del.listCouriers(ctx.db, all === '1');
  });
  app.post('/api/couriers', async (req) => {
    const ctx = app.ctx(req);
    const body = z
      .object({
        id: uuid.optional(),
        name: z.string().min(1).max(80),
        phone: z.string().max(30).nullish(),
        userId: uuid.nullish(),
        defaultFeeCents: cents,
        active: z.boolean().optional(),
        notes: z.string().max(300).nullish(),
      })
      .parse(req.body);
    return del.saveCourier(ctx, body);
  });
  app.get('/api/deliveries', async (req) => del.deliveryBoard(app.ctx(req)));
  app.post('/api/deliveries/assign', async (req) => {
    const ctx = app.ctx(req);
    const body = z.object({ orderIds: z.array(uuid).min(1).max(20), courierId: uuid }).parse(req.body);
    return del.assignOrders(ctx, body.orderIds, body.courierId);
  });
  app.post('/api/deliveries/:id/unassign', async (req) => del.unassignOrder(app.ctx(req), idParam.parse(req.params).id));
  app.post('/api/deliveries/runs/:id/depart', async (req) => del.departRun(app.ctx(req), idParam.parse(req.params).id));
  app.post('/api/deliveries/:id/status', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ status: z.enum(DELIVERY_STATUSES), note: z.string().max(300).nullish() }).parse(req.body);
    return del.setDeliveryStatus(ctx, id, body.status, body.note);
  });
  app.get('/api/courier/me', async (req) => del.courierView(app.ctx(req)));
  app.get('/api/couriers/:id/pending', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'couriers.settle');
    return del.courierPending(ctx.db, idParam.parse(req.params).id);
  });
  app.post('/api/couriers/:id/adjustments', async (req) => {
    const ctx = app.ctx(req);
    const body = z.object({ type: z.enum(['bonus', 'deduction']), amountCents: cents, reason: z.string().min(1).max(200) }).parse(req.body);
    return del.addAdjustment(ctx, idParam.parse(req.params).id, body);
  });
  app.post('/api/couriers/:id/settle', async (req) => {
    const ctx = app.ctx(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ paidFromCash: z.boolean(), notes: z.string().max(300).nullish(), expectedTotalCents: z.number().int() }).parse(req.body);
    return del.settleCourier(ctx, id, body, idem(req, `courier.settle:${id}`, body));
  });
  app.get('/api/settlements', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'couriers.settle');
    const { courierId } = z.object({ courierId: uuid.optional() }).parse(req.query);
    return del.listSettlements(ctx.db, courierId);
  });
}
