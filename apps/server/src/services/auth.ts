import { and, eq, gt, sql } from 'drizzle-orm';
import { can, type Permission, type Role } from '@guto/core';
import type { DbOrTx } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { now } from '../lib/clock.js';
import { randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../lib/context.js';

export const SESSION_COOKIE = 'guto_session';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_FAILED = 5;
const LOCK_MS = 5 * 60 * 1000;

// hash fictício para manter tempo de resposta semelhante quando o usuário não existe
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

/** Confere usuário/senha com bloqueio temporário após tentativas falhas. */
export async function checkCredentials(db: DbOrTx, username: string, password: string) {
  const [u] = await db.select().from(users).where(eq(users.username, username.trim().toLowerCase()));
  if (!u || !u.active) {
    await verifyPassword(password, DUMMY_HASH);
    throw new AppError(401, 'invalid_credentials', 'Usuário ou senha incorretos');
  }
  if (u.lockedUntil && u.lockedUntil > now()) {
    throw new AppError(429, 'locked', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  }
  const ok = await verifyPassword(password, u.passwordHash);
  if (!ok) {
    const failed = u.failedLogins + 1;
    await db
      .update(users)
      .set({
        failedLogins: failed >= MAX_FAILED ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(now().getTime() + LOCK_MS) : null,
      })
      .where(eq(users.id, u.id));
    throw new AppError(401, 'invalid_credentials', 'Usuário ou senha incorretos');
  }
  if (u.failedLogins > 0 || u.lockedUntil) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  }
  return u;
}

export async function login(db: DbOrTx, username: string, password: string, userAgent?: string) {
  const u = await checkCredentials(db, username, password);
  const token = randomToken();
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId: u.id,
    createdAt: now(),
    expiresAt: new Date(now().getTime() + SESSION_TTL_MS),
    userAgent: userAgent?.slice(0, 200),
  });
  await db.update(users).set({ lastLoginAt: now() }).where(eq(users.id, u.id));
  return { token, user: publicUser(u) };
}

export function publicUser(u: { id: string; name: string; username: string; role: Role }) {
  return { id: u.id, name: u.name, username: u.username, role: u.role };
}

export async function sessionActor(db: DbOrTx, token: string | undefined): Promise<Actor | null> {
  if (!token || token.length > 100) return null;
  const rows = await db
    .select({ sid: sessions.id, lastSeen: sessions.lastSeenAt, id: users.id, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now()), eq(users.active, true)));
  const r = rows[0];
  if (!r) return null;
  if (now().getTime() - r.lastSeen.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now() }).where(eq(sessions.id, r.sid));
  }
  return { userId: r.id, name: r.name, role: r.role };
}

export async function logout(db: DbOrTx, token: string | undefined) {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function revokeUserSessions(db: DbOrTx, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions(db: DbOrTx) {
  await db.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
}

export interface SupervisorInput {
  username: string;
  password: string;
}

/**
 * Autoriza uma ação sensível. Se o perfil do operador já tem a permissão, retorna null.
 * Caso contrário exige credenciais de um supervisor (gerente/admin) com a permissão,
 * e retorna o id do supervisor para registro na auditoria.
 */
export async function authorize(
  db: DbOrTx,
  actor: Actor,
  perm: Permission,
  supervisor?: SupervisorInput | null,
): Promise<string | null> {
  if (can(actor.role, perm)) return null;
  if (!supervisor) {
    throw new AppError(403, 'supervisor_required', 'Esta ação exige autorização de um gerente', { permission: perm });
  }
  const sup = await checkCredentials(db, supervisor.username, supervisor.password);
  if (!can(sup.role, perm)) {
    throw new AppError(403, 'forbidden', 'O usuário informado não tem permissão para autorizar esta ação');
  }
  return sup.id;
}
