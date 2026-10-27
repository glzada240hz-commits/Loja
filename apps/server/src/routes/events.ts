import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can, type Role } from '@guto/core';
import { AppError } from '../lib/errors.js';
import type { LiveEvent } from '../lib/events.js';

/** Quais eventos cada perfil recebe (os eventos levam só IDs; os dados vêm da API com permissão). */
function allowed(role: Role, e: LiveEvent): boolean {
  if (e.type === 'wa.outbox') return false;
  if (role === 'courier') return e.type === 'delivery.changed' || e.type === 'day.changed';
  if (role === 'kitchen') return ['kitchen.changed', 'menu.changed', 'day.changed'].includes(e.type);
  if (role === 'waiter') return ['order.changed', 'kitchen.changed', 'menu.changed', 'day.changed', 'bill.requested'].includes(e.type);
  return true;
}

function deviceInfo(q: unknown) {
  const r = z.object({ device: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), label: z.string().max(60).optional() }).safeParse(q);
  return r.success ? { deviceId: r.data.device, label: r.data.label?.trim() || 'Dispositivo' } : null;
}

export async function eventRoutes(app: FastifyInstance) {
  // sinal de vida de cada aparelho (a cada ~15 s)
  app.post('/api/presence', async (req) => {
    const ctx = app.ctx(req);
    const d = deviceInfo(req.body);
    if (!d) throw new AppError(400, 'bad_request', 'Identificação do dispositivo inválida');
    app.presence.seen({ ...d, userId: ctx.actor.userId, userName: ctx.actor.name, role: ctx.actor.role });
    return { ok: true };
  });

  app.get('/api/presence', async (req) => {
    const ctx = app.ctx(req);
    if (!(['orders.view', 'kitchen.view'] as const).some((p) => can(ctx.actor.role, p))) throw new AppError(403, 'forbidden', 'Seu perfil não tem permissão para esta ação');
    return app.presence.list();
  });

  app.get('/api/events', async (req, reply) => {
    const ctx = app.ctx(req);
    const device = deviceInfo(req.query);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\nevent: hello\ndata: {"ok":true}\n\n`);
    const onEvent = (e: LiveEvent) => {
      if (allowed(ctx.actor.role, e)) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    app.deps.bus.on('event', onEvent);
    const ping = setInterval(() => res.write(`: ping\n\n`), 25000);
    if (device) app.presence.seen({ ...device, userId: ctx.actor.userId, userName: ctx.actor.name, role: ctx.actor.role });
    req.raw.on('close', () => {
      clearInterval(ping);
      app.deps.bus.off('event', onEvent);
      if (device) app.presence.disconnected(device.deviceId);
    });
  });
}
