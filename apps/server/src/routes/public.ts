import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { orderItemOptions, orderItems, orders } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Ctx } from '../lib/context.js';
import { currentDay } from '../services/businessDay.js';
import { listNeighborhoods } from '../services/admin.js';
import { getMenu } from '../services/menu.js';
import { createOrder } from '../services/orders.js';
import { getSettings } from '../services/settings.js';
import { addressInput, cents, idem, itemInput, paymentMethod } from './schemas.js';

/** Endpoints do cardápio digital (sem login). Nunca expõem custos, outros clientes ou funções internas. */
export async function publicRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  async function storeStatus() {
    const s = await getSettings(db);
    const day = await currentDay(db);
    const open = !!day && s.onlineOrdersEnabled;
    return {
      name: s.storeName,
      phone: s.storePhone,
      address: s.storeAddress,
      open,
      closedReason: !day ? 'A loja está fechada no momento.' : !s.onlineOrdersEnabled ? 'Pedidos online pausados no momento.' : null,
      minOrderCents: s.onlineMinOrderCents,
      pickupEtaMinutes: s.pickupEtaMinutes,
      deliveryEtaMinutes: s.deliveryEtaMinutes,
      paymentMethods: s.onlinePaymentMethods,
      pixKeyDisplay: s.pixKeyDisplay,
    };
  }

  app.get('/api/public/menu', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async () => {
    const [store, menu, nbs] = await Promise.all([storeStatus(), getMenu(db, { publicView: true }), listNeighborhoods(db, true)]);
    return {
      store,
      menu,
      neighborhoods: nbs.map((n) => ({ id: n.id, name: n.name, feeCents: n.feeCents, minOrderCents: n.minOrderCents, etaMinutes: n.etaMinutes })),
    };
  });

  app.post('/api/public/orders', { config: { rateLimit: { max: app.deps.config.CHECKOUT_RATE_LIMIT, timeWindow: '5 minutes' } } }, async (req) => {
    const body = z
      .object({
        type: z.enum(['delivery', 'takeout']),
        customer: z.object({ name: z.string().min(2).max(120), phone: z.string().min(8).max(30) }),
        address: addressInput,
        notes: z.string().max(500).nullish(),
        items: z.array(itemInput).min(1).max(50),
        paymentIntent: paymentMethod,
        changeForCents: cents.nullish(),
        waOptIn: z.boolean().optional(),
        privacyAccepted: z.literal(true),
      })
      .parse(req.body);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string') throw new AppError(400, 'idempotency_required', 'Requisição sem identificador');
    const store = await storeStatus();
    if (!store.open) throw new AppError(409, 'store_closed', store.closedReason ?? 'Loja fechada');
    if (!store.paymentMethods.includes(body.paymentIntent as never)) throw new AppError(422, 'payment_method', 'Forma de pagamento indisponível');
    // o cardápio digital age como um "sistema" sem privilégios administrativos
    const ctx: Ctx = { ...app.deps, actor: { userId: '00000000-0000-0000-0000-000000000000', role: 'cashier', name: 'Cardápio digital' } };
    const { privacyAccepted: _p, ...input } = body;
    const r = await createOrder(
      ctx,
      { ...input, source: 'online', confirmDuplicate: true, send: false, deliveryFeeCents: null, discount: null },
      { idem: idem(req, 'checkout', input) },
    );
    return { number: r.number, trackingToken: r.trackingToken };
  });

  app.get('/api/public/orders/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = z.object({ token: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/) }).parse(req.params);
    const [o] = await db.select().from(orders).where(eq(orders.trackingToken, token));
    if (!o) throw notFound('Pedido não encontrado');
    const items = await db.select().from(orderItems).where(and(eq(orderItems.orderId, o.id), eq(orderItems.status, 'active'))).orderBy(asc(orderItems.sort));
    const opts = items.length ? await db.select().from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, items.map((i) => i.id))) : [];
    const store = await storeStatus();
    return {
      number: o.number,
      type: o.type,
      status: o.status,
      stage: o.stage,
      deliveryStatus: o.deliveryStatus,
      customerFirstName: o.customerName?.split(' ')[0] ?? null,
      neighborhoodName: o.neighborhoodName,
      createdAt: o.createdAt,
      acceptedAt: o.acceptedAt,
      readyAt: o.readyAt,
      dispatchedAt: o.dispatchedAt,
      deliveredAt: o.deliveredAt,
      cancelledAt: o.cancelledAt,
      etaAt: o.etaAt,
      subtotalCents: o.subtotalCents,
      discountCents: o.discountCents,
      deliveryFeeCents: o.deliveryFeeCents,
      totalCents: o.totalCents,
      paidCents: o.paidCents,
      paymentIntent: o.paymentIntent,
      changeForCents: o.changeForCents,
      items: items.map((i) => ({
        name: i.productName + (i.variantName ? ` (${i.variantName})` : ''),
        quantity: i.quantity,
        totalCents: i.totalCents,
        notes: i.notes,
        options: opts.filter((x) => x.orderItemId === i.id).map((x) => x.optionName),
      })),
      store: { name: store.name, phone: store.phone, pixKeyDisplay: store.pixKeyDisplay },
    };
  });
}
