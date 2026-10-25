import type { DbOrTx } from '../db/index.js';
import { auditLogs, orderEvents } from '../db/schema.js';
import type { Actor } from './context.js';
import { now } from './clock.js';

export async function audit(
  tx: DbOrTx,
  actor: Actor | null,
  action: string,
  entity: string,
  entityId: string | null,
  data?: unknown,
  authorizedBy?: string | null,
) {
  await tx.insert(auditLogs).values({
    userId: actor?.userId ?? null,
    authorizedBy: authorizedBy ?? null,
    action,
    entity,
    entityId,
    data: data ?? null,
    createdAt: now(),
  });
}

export async function orderEvent(
  tx: DbOrTx,
  orderId: string,
  type: string,
  actor: Actor | null,
  data?: unknown,
  authorizedBy?: string | null,
) {
  await tx.insert(orderEvents).values({
    orderId,
    type,
    data: data ?? null,
    userId: actor?.userId ?? null,
    authorizedBy: authorizedBy ?? null,
    createdAt: now(),
  });
}
