import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { listStock } from './stock.js';

export interface Range {
  from: string; // YYYY-MM-DD (data de referência do dia operacional)
  to: string;
}

export function validateRange(r: Partial<Range>): Range {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!r.from || !r.to || !re.test(r.from) || !re.test(r.to)) throw badRequest('Período inválido (use AAAA-MM-DD)');
  if (r.from > r.to) throw badRequest('Data inicial maior que a final');
  return { from: r.from, to: r.to };
}

async function rows<T>(db: DbOrTx, q: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db.execute(q);
  return r.rows as T[];
}

const dayFilter = (r: Range) => sql`bd.reference_date between ${r.from} and ${r.to}`;

/**
 * Relatório gerencial. Conceitos (não confundir):
 * - Vendas brutas: soma dos itens dos pedidos não cancelados, antes de descontos.
 * - Vendas líquidas: brutas − descontos (sem taxa de entrega).
 * - Taxas de entrega: cobradas do cliente, separadas das vendas.
 * - Recebimentos: dinheiro/Pix/cartão efetivamente registrados (podem diferir das vendas: contas pendentes).
 * - Saldo de caixa: dinheiro físico — ver fechamento de caixa.
 * - Resultado estimado: líquidas − custo dos itens − repasses − despesas (incompleto se faltar custo).
 */
export async function salesReport(db: DbOrTx, range: Range) {
  const f = dayFilter(range);
  const [summary] = await rows<{
    orders: number;
    gross: number;
    discounts: number;
    fees: number;
    cancelled_count: number;
    cancelled_value: number;
    receivable_open: number;
  }>(
    db,
    sql`select
      count(*) filter (where o.status <> 'cancelled' and o.status <> 'pending')::int as orders,
      coalesce(sum(o.subtotal_cents) filter (where o.status not in ('cancelled','pending')), 0)::int as gross,
      coalesce(sum(o.discount_cents) filter (where o.status not in ('cancelled','pending')), 0)::int as discounts,
      coalesce(sum(o.delivery_fee_cents) filter (where o.status not in ('cancelled','pending')), 0)::int as fees,
      count(*) filter (where o.status = 'cancelled')::int as cancelled_count,
      coalesce(sum(o.total_cents) filter (where o.status = 'cancelled'), 0)::int as cancelled_value,
      coalesce(sum(o.total_cents - o.paid_cents) filter (where o.status = 'closed' and o.receivable), 0)::int as receivable_open
    from orders o join business_days bd on bd.id = o.business_day_id where ${f}`,
  );
  const s = summary!;
  const net = s.gross - s.discounts;

  const payments = await rows<{ method: string; received: number; refunded: number; count: number }>(
    db,
    sql`select p.method,
      coalesce(sum(p.amount_cents), 0)::int as received,
      coalesce(sum(p.amount_cents) filter (where p.status = 'refunded'), 0)::int as refunded,
      count(*)::int as count
    from payments p join cash_sessions cs on cs.id = p.cash_session_id join business_days bd on bd.id = cs.business_day_id
    where ${f} group by p.method order by received desc`,
  );

  const items = await rows<{ product: string; variant: string | null; category: string | null; qty: number; revenue: number; cost: number | null; missing_cost: number }>(
    db,
    sql`select oi.product_name as product, oi.variant_name as variant, oi.category_name as category,
      sum(oi.quantity)::int as qty, sum(oi.total_cents)::int as revenue,
      sum(oi.unit_cost_cents * oi.quantity)::int as cost,
      count(*) filter (where oi.unit_cost_cents is null)::int as missing_cost
    from order_items oi join orders o on o.id = oi.order_id join business_days bd on bd.id = o.business_day_id
    where ${f} and o.status not in ('cancelled','pending') and oi.status = 'active'
    group by 1,2,3 order by qty desc`,
  );

  const byCategory = await rows<{ category: string; qty: number; revenue: number }>(
    db,
    sql`select coalesce(oi.category_name, 'Sem categoria') as category, sum(oi.quantity)::int as qty, sum(oi.total_cents)::int as revenue
    from order_items oi join orders o on o.id = oi.order_id join business_days bd on bd.id = o.business_day_id
    where ${f} and o.status not in ('cancelled','pending') and oi.status = 'active' group by 1 order by revenue desc`,
  );

  const byType = await rows<{ type: string; orders: number; total: number }>(
    db,
    sql`select o.type, count(*)::int as orders, sum(o.total_cents)::int as total
    from orders o join business_days bd on bd.id = o.business_day_id
    where ${f} and o.status not in ('cancelled','pending') group by 1 order by 2 desc`,
  );

  const byHour = await rows<{ hour: number; orders: number; total: number }>(
    db,
    sql`select extract(hour from o.created_at at time zone 'America/Sao_Paulo')::int as hour, count(*)::int as orders, sum(o.total_cents)::int as total
    from orders o join business_days bd on bd.id = o.business_day_id
    where ${f} and o.status not in ('cancelled','pending') group by 1 order by 1`,
  );

  const byDay = await rows<{ reference_date: string; orders: number; net: number; fees: number }>(
    db,
    sql`select bd.reference_date, count(o.id) filter (where o.status not in ('cancelled','pending'))::int as orders,
      coalesce(sum(o.subtotal_cents - o.discount_cents) filter (where o.status not in ('cancelled','pending')), 0)::int as net,
      coalesce(sum(o.delivery_fee_cents) filter (where o.status not in ('cancelled','pending')), 0)::int as fees
    from business_days bd left join orders o on o.business_day_id = bd.id
    where ${f} group by bd.id, bd.reference_date order by bd.reference_date`,
  );

  const byNeighborhood = await rows<{ neighborhood: string; orders: number; fees: number; total: number }>(
    db,
    sql`select coalesce(o.neighborhood_name, '-') as neighborhood, count(*)::int as orders, sum(o.delivery_fee_cents)::int as fees, sum(o.total_cents)::int as total
    from orders o join business_days bd on bd.id = o.business_day_id
    where ${f} and o.type = 'delivery' and o.status not in ('cancelled','pending') group by 1 order by 2 desc`,
  );

  const couriers = await rows<{ courier: string; deliveries: number; fees_owed: number; avg_minutes: number | null; issues: number }>(
    db,
    sql`select c.name as courier,
      count(*) filter (where o.delivery_status = 'delivered')::int as deliveries,
      coalesce(sum(o.courier_fee_cents) filter (where o.delivery_status = 'delivered'), 0)::int as fees_owed,
      round(avg(extract(epoch from (o.delivered_at - o.dispatched_at)) / 60) filter (where o.delivered_at is not null and o.dispatched_at is not null))::int as avg_minutes,
      count(*) filter (where o.delivery_status = 'issue')::int as issues
    from orders o join couriers c on c.id = o.courier_id join business_days bd on bd.id = o.business_day_id
    where ${f} and o.status <> 'cancelled' group by c.id, c.name order by 2 desc`,
  );

  const [times] = await rows<{ avg_prep: number | null; avg_delivery: number | null; avg_total_delivery: number | null }>(
    db,
    sql`select
      (select round(avg(extract(epoch from (kt.ready_at - kt.created_at)) / 60))::int from kitchen_tickets kt join orders o on o.id = kt.order_id join business_days bd on bd.id = o.business_day_id where ${f} and kt.ready_at is not null and o.status <> 'cancelled') as avg_prep,
      (select round(avg(extract(epoch from (o.delivered_at - o.dispatched_at)) / 60))::int from orders o join business_days bd on bd.id = o.business_day_id where ${f} and o.type = 'delivery' and o.delivered_at is not null and o.dispatched_at is not null) as avg_delivery,
      (select round(avg(extract(epoch from (o.delivered_at - o.created_at)) / 60))::int from orders o join business_days bd on bd.id = o.business_day_id where ${f} and o.type = 'delivery' and o.delivered_at is not null) as avg_total_delivery`,
  );

  const [exp] = await rows<{ total: number }>(
    db,
    sql`select coalesce(sum(amount_cents), 0)::int as total from expenses where deleted_at is null and date between ${range.from} and ${range.to}`,
  );

  const cogs = items.reduce((a, i) => a + (i.cost ?? 0), 0);
  const missingCostLines = items.filter((i) => i.missing_cost > 0).map((i) => i.product + (i.variant ? ' ' + i.variant : ''));
  const courierFees = couriers.reduce((a, c) => a + c.fees_owed, 0);
  const receivedNet = payments.reduce((a, p) => a + p.received - p.refunded, 0);

  return {
    range,
    summary: {
      orders: s.orders,
      grossCents: s.gross,
      discountsCents: s.discounts,
      netCents: net,
      deliveryFeesCents: s.fees,
      billedCents: net + s.fees,
      averageTicketCents: s.orders ? Math.round((net + s.fees) / s.orders) : 0,
      cancelledCount: s.cancelled_count,
      cancelledValueCents: s.cancelled_value,
      receivableOpenCents: s.receivable_open,
      receivedNetCents: receivedNet,
    },
    margin: {
      netSalesCents: net,
      costOfGoodsCents: cogs,
      grossMarginCents: net - cogs,
      courierFeesCents: courierFees,
      deliveryFeesCents: s.fees,
      expensesCents: exp?.total ?? 0,
      estimatedResultCents: net + s.fees - cogs - courierFees - (exp?.total ?? 0),
      complete: missingCostLines.length === 0,
      missingCost: missingCostLines,
    },
    payments,
    items,
    byCategory,
    byType,
    byHour,
    byDay,
    byNeighborhood,
    couriers,
    times: { avgPrepMinutes: times?.avg_prep ?? null, avgDeliveryMinutes: times?.avg_delivery ?? null, avgOrderToDoorMinutes: times?.avg_total_delivery ?? null },
    lowStock: (await listStock(db)).filter((x) => x.low),
  };
}

// ---------------- exportação CSV ----------------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // evita injeção de fórmulas ao abrir no Excel/Planilhas
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rowsIn: Record<string, unknown>[], columns: { key: string; label: string; money?: boolean }[]): string {
  const head = columns.map((c) => csvCell(c.label)).join(';');
  const body = rowsIn.map((r) =>
    columns
      .map((c) => {
        const v = r[c.key];
        if (c.money && typeof v === 'number') return (v / 100).toFixed(2).replace('.', ',');
        return csvCell(v);
      })
      .join(';'),
  );
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

export async function exportCsv(db: DbOrTx, kind: string, range: Range): Promise<{ filename: string; csv: string }> {
  const f = dayFilter(range);
  const suffix = `${range.from}_a_${range.to}.csv`;
  switch (kind) {
    case 'orders': {
      const r = await rows<Record<string, unknown>>(
        db,
        sql`select bd.reference_date as dia, o.number as numero, o.id as id_interno, o.type as tipo, o.source as origem, o.status as situacao,
          to_char(o.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as criado_em,
          o.customer_name as cliente, o.neighborhood_name as bairro,
          o.subtotal_cents, o.discount_cents, o.discount_reason, o.delivery_fee_cents, o.total_cents, o.paid_cents, o.cancel_reason,
          (select name from couriers c where c.id = o.courier_id) as entregador, (select name from users u where u.id = o.created_by) as atendente
        from orders o join business_days bd on bd.id = o.business_day_id where ${f} order by o.created_at`,
      );
      return {
        filename: 'pedidos_' + suffix,
        csv: toCsv(r, [
          { key: 'dia', label: 'Dia operacional' },
          { key: 'numero', label: 'Número' },
          { key: 'id_interno', label: 'ID interno' },
          { key: 'tipo', label: 'Tipo' },
          { key: 'origem', label: 'Origem' },
          { key: 'situacao', label: 'Situação' },
          { key: 'criado_em', label: 'Criado em' },
          { key: 'cliente', label: 'Cliente' },
          { key: 'bairro', label: 'Bairro' },
          { key: 'subtotal_cents', label: 'Itens (R$)', money: true },
          { key: 'discount_cents', label: 'Desconto (R$)', money: true },
          { key: 'discount_reason', label: 'Motivo do desconto' },
          { key: 'delivery_fee_cents', label: 'Taxa de entrega (R$)', money: true },
          { key: 'total_cents', label: 'Total (R$)', money: true },
          { key: 'paid_cents', label: 'Pago (R$)', money: true },
          { key: 'cancel_reason', label: 'Motivo do cancelamento' },
          { key: 'entregador', label: 'Entregador' },
          { key: 'atendente', label: 'Atendente' },
        ]),
      };
    }
    case 'items': {
      const r = await rows<Record<string, unknown>>(
        db,
        sql`select bd.reference_date as dia, o.number as numero, oi.product_name, oi.variant_name, oi.category_name, oi.quantity, oi.unit_price_cents, oi.options_unit_cents, oi.total_cents, oi.unit_cost_cents, oi.status,
          (select string_agg(oo.option_name, ', ') from order_item_options oo where oo.order_item_id = oi.id) as adicionais
        from order_items oi join orders o on o.id = oi.order_id join business_days bd on bd.id = o.business_day_id where ${f} and o.status not in ('cancelled','pending') order by o.created_at`,
      );
      return {
        filename: 'itens_' + suffix,
        csv: toCsv(r, [
          { key: 'dia', label: 'Dia operacional' },
          { key: 'numero', label: 'Pedido' },
          { key: 'product_name', label: 'Produto' },
          { key: 'variant_name', label: 'Tamanho' },
          { key: 'category_name', label: 'Categoria' },
          { key: 'adicionais', label: 'Adicionais' },
          { key: 'quantity', label: 'Qtd' },
          { key: 'unit_price_cents', label: 'Preço unit. (R$)', money: true },
          { key: 'options_unit_cents', label: 'Adicionais unit. (R$)', money: true },
          { key: 'total_cents', label: 'Total (R$)', money: true },
          { key: 'unit_cost_cents', label: 'Custo unit. (R$)', money: true },
          { key: 'status', label: 'Situação do item' },
        ]),
      };
    }
    case 'payments': {
      const r = await rows<Record<string, unknown>>(
        db,
        sql`select bd.reference_date as dia, o.number as numero, p.method, p.amount_cents, p.tendered_cents, p.change_cents, p.status, p.refund_reason,
          to_char(p.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as em, (select name from users u where u.id = p.created_by) as usuario
        from payments p join orders o on o.id = p.order_id join cash_sessions cs on cs.id = p.cash_session_id join business_days bd on bd.id = cs.business_day_id where ${f} order by p.created_at`,
      );
      return {
        filename: 'pagamentos_' + suffix,
        csv: toCsv(r, [
          { key: 'dia', label: 'Dia operacional' },
          { key: 'numero', label: 'Pedido' },
          { key: 'method', label: 'Forma' },
          { key: 'amount_cents', label: 'Valor (R$)', money: true },
          { key: 'tendered_cents', label: 'Recebido (R$)', money: true },
          { key: 'change_cents', label: 'Troco (R$)', money: true },
          { key: 'status', label: 'Situação' },
          { key: 'refund_reason', label: 'Motivo do estorno' },
          { key: 'em', label: 'Data/hora' },
          { key: 'usuario', label: 'Usuário' },
        ]),
      };
    }
    case 'cash': {
      const r = await rows<Record<string, unknown>>(
        db,
        sql`select bd.reference_date as dia, cm.type, cm.method, cm.amount_cents, cm.reason,
          to_char(cm.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as em, (select name from users u where u.id = cm.created_by) as usuario
        from cash_movements cm join cash_sessions cs on cs.id = cm.cash_session_id join business_days bd on bd.id = cs.business_day_id where ${f} order by cm.created_at`,
      );
      return {
        filename: 'caixa_' + suffix,
        csv: toCsv(r, [
          { key: 'dia', label: 'Dia operacional' },
          { key: 'type', label: 'Tipo' },
          { key: 'method', label: 'Forma' },
          { key: 'amount_cents', label: 'Valor (R$)', money: true },
          { key: 'reason', label: 'Descrição' },
          { key: 'em', label: 'Data/hora' },
          { key: 'usuario', label: 'Usuário' },
        ]),
      };
    }
    case 'deliveries': {
      const r = await rows<Record<string, unknown>>(
        db,
        sql`select bd.reference_date as dia, o.number as numero, c.name as entregador, o.neighborhood_name as bairro, o.delivery_fee_cents, o.courier_fee_cents, o.delivery_status,
          to_char(o.dispatched_at at time zone 'America/Sao_Paulo', 'HH24:MI') as saida, to_char(o.delivered_at at time zone 'America/Sao_Paulo', 'HH24:MI') as entrega,
          case when o.courier_settlement_id is null then 'pendente' else 'acertado' end as acerto
        from orders o join couriers c on c.id = o.courier_id join business_days bd on bd.id = o.business_day_id where ${f} and o.status <> 'cancelled' order by o.created_at`,
      );
      return {
        filename: 'entregas_' + suffix,
        csv: toCsv(r, [
          { key: 'dia', label: 'Dia operacional' },
          { key: 'numero', label: 'Pedido' },
          { key: 'entregador', label: 'Entregador' },
          { key: 'bairro', label: 'Bairro' },
          { key: 'delivery_fee_cents', label: 'Taxa cobrada (R$)', money: true },
          { key: 'courier_fee_cents', label: 'Repasse (R$)', money: true },
          { key: 'delivery_status', label: 'Situação' },
          { key: 'saida', label: 'Saída' },
          { key: 'entrega', label: 'Entrega' },
          { key: 'acerto', label: 'Acerto' },
        ]),
      };
    }
    case 'expenses': {
      const r = await rows<Record<string, unknown>>(
        db,
        sql`select e.date, e.category, e.description, e.amount_cents, e.paid_from_cash from expenses e where e.deleted_at is null and e.date between ${range.from} and ${range.to} order by e.date`,
      );
      return {
        filename: 'despesas_' + suffix,
        csv: toCsv(r, [
          { key: 'date', label: 'Data' },
          { key: 'category', label: 'Categoria' },
          { key: 'description', label: 'Descrição' },
          { key: 'amount_cents', label: 'Valor (R$)', money: true },
          { key: 'paid_from_cash', label: 'Pago pelo caixa' },
        ]),
      };
    }
    default:
      throw badRequest('Tipo de exportação inválido');
  }
}
