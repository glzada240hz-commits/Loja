import { z } from 'zod';
import { ORDER_TYPES } from '@guto/core';
import type { FastifyRequest } from 'fastify';
import { idemFrom } from '../lib/idempotency.js';

export const uuid = z.string().uuid();
export const cents = z.number().int().min(0).max(100_000_000);
export const idParam = z.object({ id: uuid });

export const supervisor = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }).nullish();

export const itemInput = z.object({
  variantId: uuid,
  quantity: z.number().int().min(1).max(99),
  options: z.array(z.object({ optionId: uuid, quantity: z.number().int().min(1).max(10) })).max(30).optional(),
  notes: z.string().max(300).nullish(),
});

export const customerInput = z.object({ name: z.string().max(120).nullish(), phone: z.string().max(30).nullish() }).nullish();
export const addressInput = z
  .object({
    street: z.string().min(1).max(150),
    number: z.string().min(1).max(20),
    complement: z.string().max(100).nullish(),
    reference: z.string().max(150).nullish(),
    neighborhoodId: uuid,
  })
  .nullish();
export const discountInput = z
  .object({ type: z.enum(['amount', 'percent']), value: z.number().int().positive(), reason: z.string().min(1).max(200) })
  .nullish();
export const orderType = z.enum(ORDER_TYPES);
export const paymentMethod = z.enum(['cash', 'pix_manual', 'pix_integrated', 'credit', 'debit', 'voucher']);

/** Escopo da chave de idempotência inclui usuário e operação. */
export function idem(req: FastifyRequest, op: string, body: unknown) {
  const key = req.headers['idempotency-key'];
  const scope = req.actor ? `user:${req.actor.userId}:${op}` : `public:${op}`;
  return idemFrom(scope, typeof key === 'string' ? key : undefined, body);
}
