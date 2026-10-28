import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { ROLE_PERMISSIONS } from '@guto/core';
import { users } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { hashPassword } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';
import { SESSION_COOKIE, SESSION_TTL_MS, checkCredentials, login, logout, revokeUserSessions } from '../services/auth.js';
import { validatePassword } from '../services/admin.js';

export async function authRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  // Em produção sempre Secure; fora dela, conforme o acesso (HTTPS pelo túnel/proxy ou HTTP na rede local de testes).
  const isSecure = (protocol: string) => config.NODE_ENV === 'production' || protocol === 'https';

  app.post('/api/auth/login', { config: { rateLimit: { max: config.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }).parse(req.body);
    const r = await login(db, body.username, body.password, req.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: 'lax', secure: isSecure(req.protocol), path: '/', maxAge: SESSION_TTL_MS / 1000 });
    await audit(db, { userId: r.user.id, role: r.user.role, name: r.user.name }, 'auth.login', 'user', r.user.id);
    return { user: r.user, permissions: [...ROLE_PERMISSIONS[r.user.role]] };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await logout(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.actor) throw unauthorized();
    const [u] = await db.select({ id: users.id, name: users.name, username: users.username, role: users.role }).from(users).where(eq(users.id, req.actor.userId));
    return { user: u, permissions: [...ROLE_PERMISSIONS[req.actor.role]] };
  });

  app.post('/api/auth/password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ctx = app.ctx(req);
    const body = z.object({ current: z.string().min(1), next: z.string() }).parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, ctx.actor.userId));
    await checkCredentials(db, u!.username, body.current);
    validatePassword(body.next);
    await db.update(users).set({ passwordHash: await hashPassword(body.next), updatedAt: new Date() }).where(eq(users.id, u!.id));
    await revokeUserSessions(db, u!.id);
    await audit(db, ctx.actor, 'auth.password_change', 'user', u!.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, message: 'Senha alterada. Entre novamente.' };
  });
}
