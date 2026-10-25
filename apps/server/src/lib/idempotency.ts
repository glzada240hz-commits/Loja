import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db/index.js';
import { idempotencyKeys } from '../db/schema.js';
import { sha256 } from './crypto.js';
import { AppError } from './errors.js';

export interface IdemKey {
  scope: string; // ex.: user:<id>:orders.create  ou  public:checkout
  key: string;
  hash: string;
}

export function idemFrom(scope: string, key: string | undefined, body: unknown): IdemKey | undefined {
  if (!key) return undefined;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppError(400, 'bad_idempotency_key', 'Idempotency-Key inválida');
  return { scope, key, hash: sha256(JSON.stringify(body ?? null)) };
}

/**
 * Executa `fn` no máximo uma vez por chave. O registro da chave é gravado na MESMA transação
 * da operação: uma requisição repetida (duplo clique, reenvio de rede) aguarda a primeira
 * terminar e recebe a mesma resposta, sem duplicar pedidos, pagamentos ou movimentos.
 */
export async function idempotent<T>(tx: Tx, idem: IdemKey | undefined, fn: () => Promise<T>): Promise<{ value: T; replayed: boolean }> {
  if (!idem) return { value: await fn(), replayed: false };
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ scope: idem.scope, key: idem.key, requestHash: idem.hash })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted.length === 0) {
    const [row] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, idem.scope), eq(idempotencyKeys.key, idem.key)));
    if (!row) throw new AppError(409, 'idempotency_in_progress', 'Requisição em processamento, tente novamente');
    if (row.requestHash !== idem.hash) {
      throw new AppError(422, 'idempotency_mismatch', 'Esta chave de requisição já foi usada com outros dados');
    }
    return { value: row.response as T, replayed: true };
  }
  const value = await fn();
  await tx
    .update(idempotencyKeys)
    .set({ response: (value ?? null) as never, statusCode: 200 })
    .where(and(eq(idempotencyKeys.scope, idem.scope), eq(idempotencyKeys.key, idem.key)));
  return { value, replayed: false };
}
