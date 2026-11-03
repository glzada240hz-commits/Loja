/**
 * "Zerar pedidos de teste": apaga o MOVIMENTO (pedidos, cozinha, pagamentos, caixas, dias, entregas, acertos,
 * despesas e, opcionalmente, clientes) e devolve ao estoque o que os pedidos baixaram. Mantém cardápio,
 * acréscimos, bairros, usuários, entregadores, estoque cadastrado e ajustes.
 * Antes de apagar, grava tudo o que vai sair num arquivo JSON (pasta "zerados" ao lado das fotos).
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { audit } from '../lib/audit.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { badRequest } from '../lib/errors.js';
import { now } from '../lib/clock.js';

const MOVEMENT_TABLES = [
  'payments', 'order_item_options', 'order_items', 'order_events', 'kitchen_tickets', 'orders', 'delivery_runs',
  'courier_adjustments', 'courier_settlements', 'cash_movements', 'expenses', 'cash_sessions', 'business_days',
] as const;

export async function resetMovement(ctx: Ctx, opts: { confirm: string; customers: boolean }) {
  requirePerm(ctx.actor, 'users.manage'); // só o administrador
  if (opts.confirm.trim().toUpperCase() !== 'ZERAR') throw badRequest('Digite ZERAR para confirmar');
  const tables = [...MOVEMENT_TABLES, ...(opts.customers ? (['customer_addresses', 'customers'] as const) : [])];

  // cópia do que vai sair (antes de apagar)
  const dump: Record<string, unknown[]> = {};
  for (const t of [...tables, 'stock_movements']) {
    const where = t === 'stock_movements' ? sql` where source_type = 'order_item'` : sql``;
    dump[t] = (await ctx.db.execute(sql`select * from ${sql.identifier(t)}${where}`)).rows;
  }
  const dir = path.join(path.dirname(path.resolve(ctx.config.UPLOAD_DIR)), 'zerados');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `zerado-${now().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ when: now().toISOString(), by: ctx.actor.name, tables: dump }));

  const counts = Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length]));
  return inTx(ctx, async (tx, emit) => {
    // devolve ao estoque o que as vendas de teste baixaram (e estornos), e apaga esses movimentos
    await tx.execute(sql`
      update stock_items s set quantity = s.quantity - m.net, updated_at = now()
      from (select stock_item_id, sum(quantity) as net from stock_movements where source_type = 'order_item' group by stock_item_id) m
      where s.id = m.stock_item_id`);
    await tx.execute(sql`delete from stock_movements where source_type = 'order_item'`);
    await tx.execute(sql`update wa_messages set order_id = null where order_id is not null`);
    if (opts.customers) await tx.execute(sql`update wa_contacts set customer_id = null where customer_id is not null`);
    for (const t of tables) await tx.execute(sql`delete from ${sql.identifier(t)}`);
    await tx.execute(sql`delete from idempotency_keys`);
    await audit(tx, ctx.actor, 'admin.reset_movement', 'system', null, { counts, backupFile: path.basename(file), customers: opts.customers });
    for (const type of ['order.changed', 'kitchen.changed', 'cash.changed', 'day.changed', 'stock.changed'] as const) emit({ type } as never);
    return { ok: true, counts, backupFile: file };
  });
}
