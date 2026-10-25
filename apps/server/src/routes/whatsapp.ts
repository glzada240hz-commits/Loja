import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizePhoneBR } from '@guto/core';
import { requirePerm } from '../lib/context.js';
import { randomToken } from '../lib/crypto.js';
import { AppError, unauthorized } from '../lib/errors.js';
import * as inbox from '../whatsapp/inbox.js';
import { buildInboundPayload, ingestWebhook, verifySignature } from '../whatsapp/webhook.js';
import { idem, idParam, uuid } from './schemas.js';

export async function whatsappRoutes(app: FastifyInstance) {
  const { config } = app.deps;

  // ---------- webhook oficial (Meta) ----------
  app.get('/api/webhooks/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (q['hub.mode'] === 'subscribe' && config.WHATSAPP_VERIFY_TOKEN && q['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.status(403).send('forbidden');
  });

  app.post('/api/webhooks/whatsapp', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (config.WHATSAPP_MODE !== 'cloud' || !config.WHATSAPP_APP_SECRET) {
      return reply.status(503).send({ error: { code: 'not_configured', message: 'Integração WhatsApp não configurada (modo demonstrativo)' } });
    }
    const sig = req.headers['x-hub-signature-256'];
    if (!req.rawBody || !verifySignature(req.rawBody, typeof sig === 'string' ? sig : undefined, config.WHATSAPP_APP_SECRET)) {
      req.log.warn('webhook WhatsApp com assinatura inválida');
      throw unauthorized('Assinatura inválida');
    }
    await ingestWebhook(app.deps, req.body as never);
    return { ok: true };
  });

  // ---------- caixa de entrada ----------
  app.get('/api/whatsapp/status', async (req) => {
    app.ctx(req);
    return {
      mode: app.wa.mode,
      configured: config.WHATSAPP_MODE === 'cloud',
      webhookPath: '/api/webhooks/whatsapp',
      graphVersion: config.WHATSAPP_GRAPH_VERSION,
    };
  });
  app.get('/api/whatsapp/conversations', async (req) => {
    const { q } = z.object({ q: z.string().max(60).optional() }).parse(req.query);
    return inbox.listConversations(app.ctx(req), q);
  });
  app.get('/api/whatsapp/conversations/:id', async (req) => inbox.getConversation(app.ctx(req), idParam.parse(req.params).id));
  app.post('/api/whatsapp/conversations/:id/messages', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ body: z.string().min(1).max(4096) }).parse(req.body);
    return inbox.sendAgentMessage(app.ctx(req), id, body.body, idem(req, `wa.send:${id}`, body));
  });
  app.post('/api/whatsapp/conversations/:id/menu-link', async (req) => inbox.sendMenuLink(app.ctx(req), idParam.parse(req.params).id));
  app.patch('/api/whatsapp/conversations/:id', async (req) => {
    const body = z
      .object({ botPaused: z.boolean().optional(), needsHuman: z.boolean().optional(), optInOrderUpdates: z.boolean().optional(), optInMarketing: z.boolean().optional(), customerId: uuid.nullish() })
      .parse(req.body);
    return inbox.updateContact(app.ctx(req), idParam.parse(req.params).id, body);
  });
  app.post('/api/whatsapp/messages/:id/retry', async (req) => inbox.retryMessage(app.ctx(req), idParam.parse(req.params).id));
  app.get('/api/whatsapp/monitor', async (req) => inbox.monitor(app.ctx(req)));
  app.post('/api/whatsapp/events/:id/retry', async (req) => {
    await inbox.retryWebhookEvent(app.ctx(req), idParam.parse(req.params).id);
    return { ok: true };
  });

  app.get('/api/whatsapp/quick-replies', async (req) => {
    app.ctx(req);
    return inbox.listQuickReplies(app.deps.db);
  });
  app.post('/api/whatsapp/quick-replies', async (req) => {
    const body = z.object({ id: uuid.optional(), title: z.string().min(1).max(60), body: z.string().min(1).max(1000), sort: z.number().int().optional() }).parse(req.body);
    return inbox.saveQuickReply(app.ctx(req), body);
  });
  app.delete('/api/whatsapp/quick-replies/:id', async (req) => {
    await inbox.deleteQuickReply(app.ctx(req), idParam.parse(req.params).id);
    return { ok: true };
  });
  app.get('/api/whatsapp/templates', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'whatsapp.inbox');
    return inbox.listTemplates(ctx.db);
  });
  app.post('/api/whatsapp/templates', async (req) => {
    const body = z
      .object({
        purpose: z.enum(['order_received', 'order_accepted', 'order_ready', 'order_dispatched', 'order_cancelled']),
        name: z.string().min(1).max(512),
        language: z.string().min(2).max(10),
        bodyPreview: z.string().min(1).max(1024),
        active: z.boolean(),
      })
      .parse(req.body);
    return inbox.saveTemplate(app.ctx(req), body);
  });

  // ---------- simulação (somente MODO DEMONSTRATIVO) ----------
  app.post('/api/whatsapp/demo/inbound', async (req) => {
    const ctx = app.ctx(req);
    requirePerm(ctx.actor, 'whatsapp.inbox');
    if (app.wa.mode !== 'demo') throw new AppError(409, 'not_demo', 'Simulação disponível apenas no modo demonstrativo');
    const body = z.object({ phone: z.string().min(8).max(30), name: z.string().max(60).optional(), text: z.string().min(1).max(1000) }).parse(req.body);
    const phone = normalizePhoneBR(body.phone);
    if (!phone) throw new AppError(400, 'bad_phone', 'Telefone inválido');
    const r = await ingestWebhook(app.deps, buildInboundPayload(phone, body.text, 'demo.in.' + randomToken(10), body.name ?? 'Cliente (demo)'));
    return { ok: true, ...r };
  });
}
