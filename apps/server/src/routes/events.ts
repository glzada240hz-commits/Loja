import type { FastifyInstance } from 'fastify';
import type { Role } from '@guto/core';
import type { LiveEvent } from '../lib/events.js';

/** Quais eventos cada perfil recebe (os eventos levam só IDs; os dados vêm da API com permissão). */
function allowed(role: Role, e: LiveEvent): boolean {
  if (e.type === 'wa.outbox') return false;
  if (role === 'courier') return e.type === 'delivery.changed' || e.type === 'day.changed';
  if (role === 'kitchen') return ['kitchen.changed', 'menu.changed', 'day.changed'].includes(e.type);
  return true;
}

export async function eventRoutes(app: FastifyInstance) {
  app.get('/api/events', async (req, reply) => {
    const ctx = app.ctx(req);
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
    req.raw.on('close', () => {
      clearInterval(ping);
      app.deps.bus.off('event', onEvent);
    });
  });
}
