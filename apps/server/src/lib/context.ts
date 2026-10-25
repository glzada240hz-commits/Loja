import type { Permission, Role } from '@guto/core';
import { can } from '@guto/core';
import type { Config } from '../config.js';
import type { Db, Tx } from '../db/index.js';
import type { EventBus, LiveEvent } from './events.js';
import { forbidden } from './errors.js';

export interface Actor {
  userId: string;
  role: Role;
  name: string;
}

/** Dependências compartilhadas por serviços. */
export interface Deps {
  db: Db;
  bus: EventBus;
  config: Config;
}

export interface Ctx extends Deps {
  actor: Actor;
}

export function requirePerm(actor: Actor, perm: Permission) {
  if (!can(actor.role, perm)) throw forbidden();
}

/**
 * Executa em transação e só publica os eventos em tempo real após o COMMIT,
 * para que nenhum dispositivo recarregue dados ainda não gravados.
 */
export async function inTx<T>(deps: Deps, fn: (tx: Tx, emit: (e: LiveEvent) => void) => Promise<T>): Promise<T> {
  const events: LiveEvent[] = [];
  const result = await deps.db.transaction((tx) => fn(tx, (e) => events.push(e)));
  for (const e of events) deps.bus.publish(e);
  return result;
}
