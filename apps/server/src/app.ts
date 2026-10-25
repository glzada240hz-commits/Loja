import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { createDb, type Db } from './db/index.js';
import { AppError } from './lib/errors.js';
import { EventBus } from './lib/events.js';
import type { Actor, Ctx, Deps } from './lib/context.js';
import { SESSION_COOKIE, sessionActor } from './services/auth.js';
import { configureNotify } from './whatsapp/notify.js';
import { CloudApiProvider, DemoProvider, type WaProvider } from './whatsapp/provider.js';
import { startWorkers, type Workers } from './workers.js';
import { authRoutes } from './routes/auth.js';
import { orderRoutes } from './routes/orders.js';
import { opsRoutes } from './routes/ops.js';
import { menuRoutes } from './routes/menu.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { eventRoutes } from './routes/events.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
    rawBody?: Buffer;
  }
  interface FastifyInstance {
    deps: Deps;
    wa: WaProvider;
    ctx(req: FastifyRequest): Ctx;
  }
}

export interface AppHandle {
  app: FastifyInstance;
  db: Db;
  deps: Deps;
  wa: WaProvider;
  workers: Workers | null;
  close(): Promise<void>;
}

export async function buildApp(config: Config, opts: { db?: Db; wa?: WaProvider; logger?: boolean } = {}): Promise<AppHandle> {
  let pool: { end(): Promise<void> } | null = null;
  let db = opts.db;
  if (!db) {
    const created = createDb(config.DATABASE_URL);
    db = created.db;
    pool = created.pool;
  }
  const bus = new EventBus();
  bus.setMaxListeners(500);
  const deps: Deps = { db, bus, config };
  configureNotify({ publicBaseUrl: config.PUBLIC_BASE_URL });
  const wa: WaProvider =
    opts.wa ??
    (config.WHATSAPP_MODE === 'cloud'
      ? new CloudApiProvider({ graphVersion: config.WHATSAPP_GRAPH_VERSION, phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID!, accessToken: config.WHATSAPP_ACCESS_TOKEN! })
      : new DemoProvider());

  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-hub-signature-256"]', 'res.headers["set-cookie"]'],
          },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.decorate('deps', deps);
  app.decorate('wa', wa);
  app.decorateRequest('actor', null);
  app.decorate('ctx', (req: FastifyRequest): Ctx => {
    if (!req.actor) throw new AppError(401, 'unauthorized', 'Faça login para continuar');
    return { ...deps, actor: req.actor };
  });

  // mantém o corpo bruto para validar a assinatura do webhook
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, {});
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      done(new AppError(400, 'bad_json', 'JSON inválido'), undefined);
    }
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.NODE_ENV === 'production',
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 3 * 1024 * 1024, files: 1 } });

  // sessão e proteção CSRF
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    req.actor = await sessionActor(db!, req.cookies[SESSION_COOKIE]);
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const exempt = req.url.startsWith('/api/public/') || req.url.startsWith('/api/webhooks/');
    if (mutating && !exempt && req.headers['x-requested-with'] !== 'guto') {
      throw new AppError(403, 'csrf', 'Requisição recusada (cabeçalho de segurança ausente)');
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; validation?: unknown }, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'validation', message: 'Dados inválidos: ' + err.issues.map((i) => `${i.path.join('.') || 'corpo'} ${i.message}`).join('; '), details: err.issues },
      });
    }
    if (err.code === '23505') return reply.status(409).send({ error: { code: 'duplicate', message: 'Registro duplicado' } });
    if (err.code === '40P01' || err.code === '40001') return reply.status(409).send({ error: { code: 'retry', message: 'Conflito momentâneo, tente novamente' } });
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: err.code ?? 'error', message: err.statusCode === 429 ? 'Muitas requisições. Aguarde um instante.' : err.message } });
    }
    req.log.error({ err }, 'erro interno');
    return reply.status(500).send({ error: { code: 'internal', message: 'Erro interno. A operação não foi concluída.' } });
  });

  await app.register(authRoutes);
  await app.register(orderRoutes);
  await app.register(opsRoutes);
  await app.register(menuRoutes);
  await app.register(adminRoutes);
  await app.register(publicRoutes);
  await app.register(whatsappRoutes);
  await app.register(eventRoutes);

  app.get('/api/health', async () => {
    await db!.execute('select 1' as never);
    return { ok: true, whatsappMode: wa.mode, time: new Date().toISOString() };
  });

  // fotos de produtos
  const uploadDir = path.resolve(config.UPLOAD_DIR);
  fs.mkdirSync(uploadDir, { recursive: true });
  await app.register(fastifyStatic, { root: uploadDir, prefix: '/uploads/', decorateReply: false, maxAge: '7d' });

  // aplicação web (build do Vite) com fallback para rotas do SPA
  const webDist = config.WEB_DIST ? path.resolve(config.WEB_DIST) : path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
        return reply.status(404).send({ error: { code: 'not_found', message: 'Rota não encontrada' } });
      }
      return reply.type('text/html').header('cache-control', 'no-cache').send(fs.readFileSync(path.join(webDist, 'index.html')));
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Rota não encontrada' } }));
  }

  const workers = config.DISABLE_WORKERS ? null : startWorkers(deps, wa, app.log);

  return {
    app,
    db,
    deps,
    wa,
    workers,
    async close() {
      workers?.stop();
      await app.close();
      if (pool) await pool.end();
    },
  };
}
