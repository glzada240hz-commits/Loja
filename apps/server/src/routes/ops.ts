import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can, DELIVERY_STATUSES, KITCHEN_STATUSES, ticketLines, type PrintTicket } from '@guto/core';
import { requirePerm } from '../lib/context.js';
import { authorize } from '../services/auth.js';
import { closeDay, currentDay, listDays, openDay } from '../services/businessDay.js';
import { addCashMovement, closeCash, currentCash, getCashView, listCashSessions, openCash } from '../services/cash.js';
import { kitchenQueue, setTicketStatus, ticketsForReprint } from '../services/kitchen.js';
import { jobText, readPrinterInfo, writeJob } from '../services/kitchenPrintAgent.js';
import { audit } from '../lib/audit.js';
import { forbidden, notFound } from '../lib/errors.js';
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
  /**
   * 2ª via da comanda (perdeu a via): com o aplicativo da loja e impressora da cozinha escolhida, imprime direto
   * nela; senão avisa o computador que imprime a cozinha pelo navegador. Imprime mesmo pedidos já prontos.
   */
  app.post('/api/kitchen/reprint', async (req) => {
    const ctx = app.ctx(req);
    if (!can(ctx.actor.role, 'kitchen.view') && !can(ctx.actor.role, 'orders.view')) throw forbidden();
    const body = z.object({ ticketId: uuid.optional(), orderId: uuid.optional() }).refine((b) => !!b.ticketId || !!b.orderId).parse(req.body);
    const tickets = await ticketsForReprint(ctx.db, body);
    if (!tickets.length) throw notFound('Nada para imprimir: este pedido não tem itens da cozinha');
    const s = await getSettings(ctx.db);
    const dir = app.deps.config.PRINT_DIR;
    let via: 'impressora' | 'computador';
    if (dir && s.kitchenPrinterName.trim() && readPrinterInfo(dir).agent) {
      const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
      for (const t of tickets) {
        const pt = { ...t, createdAt: iso(t.createdAt)!, changedAt: iso(t.changedAt) } as unknown as PrintTicket;
        writeJob(dir, `${t.orderNumber}-reimpressao`, jobText(s.kitchenPrinterName.trim(), s.printWidth, ticketLines(pt, 'reimpressao')));
      }
      via = 'impressora';
    } else {
      app.deps.bus.publish({ type: 'kitchen.reprint', ticketIds: tickets.map((t) => t.id) });
      via = 'computador';
    }
    await audit(ctx.db, ctx.actor, 'kitchen.reprint', 'order', tickets[0]!.orderId, { tickets: tickets.length, via });
    return { via, count: tickets.length, orderNumber: tickets[0]!.orderNumber };
  });
  /** tickets pedidos numa 2ª via (o computador que imprime a cozinha busca por aqui) */
  app.get('/api/kitchen/tickets', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'kitchen.view');
    const { ids } = z.object({ ids: z.string().max(2000) }).parse(req.query);
    const list = ids.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
    const out = [];
    for (const id of list) out.push(...(await ticketsForReprint(ctx.db, { ticketId: id })));
    return { tickets: out };
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
