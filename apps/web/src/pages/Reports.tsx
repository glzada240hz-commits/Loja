import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatBRL, ORDER_TYPE_LABEL, PAYMENT_METHOD_LABEL, type OrderType, type PaymentMethod } from '@guto/core';
import { Layout } from '../components/Layout';
import { Chips, Empty, ErrorBox, Field, Loading, Money } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysAgoISO, formatDate, todayISO } from '../lib/format';

type Preset = 'today' | '7' | '30' | 'custom';

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0;
  return (
    <div title={label} aria-hidden style={{ background: 'var(--line)', borderRadius: 5, height: 10, width: '100%', minWidth: 80 }}>
      <div className="bar" style={{ width: pct + '%' }} />
    </div>
  );
}

export default function Reports() {
  const { can } = useAuth();
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const range =
    preset === 'today' ? { from: daysAgoISO(1), to: todayISO() } : preset === '7' ? { from: daysAgoISO(6), to: todayISO() } : preset === '30' ? { from: daysAgoISO(29), to: todayISO() } : { from, to };
  const q = useQuery({ queryKey: ['reports', range.from, range.to], queryFn: () => get<any>(`/api/reports/sales?from=${range.from}&to=${range.to}`) });
  const r = q.data;
  const exportUrl = (kind: string) => `/api/reports/export?kind=${kind}&from=${range.from}&to=${range.to}`;
  return (
    <Layout title="Relatórios">
      <div className="page-head">
        <Chips
          label="Período"
          value={preset}
          onChange={setPreset}
          options={[
            { id: 'today', label: 'Ontem e hoje' },
            { id: '7', label: '7 dias' },
            { id: '30', label: '30 dias' },
            { id: 'custom', label: 'Personalizado' },
          ]}
        />
        {preset === 'custom' && (
          <div className="row" style={{ maxWidth: 380 }}>
            <Field label="De"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Até"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        )}
      </div>
      <p className="muted">
        Período pela data de abertura do dia operacional (pedidos após a meia-noite contam no dia em que o turno abriu). Pedidos aguardando aceite não entram.
      </p>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : (
        r && (
          <>
            <div className="grid cols-4">
              <Stat label="Vendas brutas (itens)" value={r.summary.grossCents} sub={`${r.summary.orders} pedidos`} />
              <Stat label="Descontos" value={r.summary.discountsCents} />
              <Stat label="Vendas líquidas" value={r.summary.netCents} sub="itens − descontos, sem entrega" />
              <Stat label="Taxas de entrega" value={r.summary.deliveryFeesCents} sub="cobradas do cliente" />
              <Stat label="Ticket médio" value={r.summary.averageTicketCents} sub="(líquidas + entrega) / pedidos" />
              <Stat label="Recebimentos" value={r.summary.receivedNetCents} sub="dinheiro, Pix e cartões, menos estornos" />
              <Stat label="Contas pendentes" value={r.summary.receivableOpenCents} />
              <Stat label="Cancelamentos" value={r.summary.cancelledValueCents} sub={`${r.summary.cancelledCount} pedido(s)`} />
            </div>

            <section className="card" style={{ marginTop: 12 }}>
              <h2>Resultado estimado {!r.margin.complete && <span className="badge orange">incompleto</span>}</h2>
              {!r.margin.complete && (
                <div className="alert warn">
                  Margem incompleta: faltam custos de {r.margin.missingCost.slice(0, 6).join(', ')}
                  {r.margin.missingCost.length > 6 ? '…' : ''}. Cadastre o custo no cardápio para um resultado confiável.
                </div>
              )}
              <div className="totals" style={{ maxWidth: 460 }}>
                <span>Vendas líquidas</span><Money cents={r.margin.netSalesCents} />
                <span>(+) Taxas de entrega</span><Money cents={r.margin.deliveryFeesCents} />
                <span>(−) Custo dos itens vendidos</span><Money cents={r.margin.costOfGoodsCents} />
                <span>(−) Repasses a entregadores</span><Money cents={r.margin.courierFeesCents} />
                <span>(−) Despesas lançadas</span><Money cents={r.margin.expensesCents} />
                <b>Resultado estimado</b><b className="num">{formatBRL(r.margin.estimatedResultCents)}</b>
              </div>
              <small className="muted">Faturamento, saldo de caixa e lucro são coisas diferentes: este é um resultado estimado, não um demonstrativo contábil.</small>
            </section>

            <div className="grid cols-2" style={{ marginTop: 12 }}>
              <section className="card">
                <h2>Formas de pagamento</h2>
                <SimpleTable
                  rows={r.payments}
                  empty="Sem recebimentos"
                  cols={[
                    { label: 'Forma', render: (p: any) => PAYMENT_METHOD_LABEL[p.method as PaymentMethod] },
                    { label: 'Qtd', right: true, render: (p: any) => p.count },
                    { label: 'Estornado', right: true, render: (p: any) => <Money cents={p.refunded} /> },
                    { label: 'Líquido', right: true, render: (p: any) => <b><Money cents={p.received - p.refunded} /></b> },
                  ]}
                />
              </section>
              <section className="card">
                <h2>Por tipo de pedido</h2>
                <SimpleTable
                  rows={r.byType}
                  empty="Sem pedidos"
                  cols={[
                    { label: 'Tipo', render: (t: any) => ORDER_TYPE_LABEL[t.type as OrderType] },
                    { label: 'Pedidos', right: true, render: (t: any) => t.orders },
                    { label: 'Total', right: true, render: (t: any) => <Money cents={t.total} /> },
                  ]}
                />
                <h2 style={{ marginTop: 12 }}>Tempos médios</h2>
                <p>
                  Preparo (cozinha): <b>{r.times.avgPrepMinutes ?? '—'} min</b> · Em rota: <b>{r.times.avgDeliveryMinutes ?? '—'} min</b> · Do pedido à porta:{' '}
                  <b>{r.times.avgOrderToDoorMinutes ?? '—'} min</b>
                </p>
              </section>
            </div>

            <section className="card" style={{ marginTop: 12 }}>
              <h2>Vendas por hora</h2>
              {r.byHour.length === 0 ? (
                <Empty title="Sem vendas" />
              ) : (
                <table className="table bars">
                  <thead><tr><th>Hora</th><th>Pedidos</th><th style={{ width: '50%' }}>Total</th><th className="right">Valor</th></tr></thead>
                  <tbody>
                    {r.byHour.map((h: any) => (
                      <tr key={h.hour}>
                        <td>{String(h.hour).padStart(2, '0')}h</td>
                        <td>{h.orders}</td>
                        <td><Bar value={h.total} max={Math.max(...r.byHour.map((x: any) => x.total))} label={`${String(h.hour).padStart(2, '0')}h: ${formatBRL(h.total)} em ${h.orders} pedidos`} /></td>
                        <td className="right"><Money cents={h.total} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card">
              <h2>Por dia operacional</h2>
              <SimpleTable
                rows={r.byDay}
                empty="Nenhum dia no período"
                cols={[
                  { label: 'Dia', render: (d: any) => formatDate(d.reference_date + 'T12:00:00') },
                  { label: 'Pedidos', right: true, render: (d: any) => d.orders },
                  { label: 'Líquido', right: true, render: (d: any) => <Money cents={d.net} /> },
                  { label: 'Entregas', right: true, render: (d: any) => <Money cents={d.fees} /> },
                ]}
              />
            </section>

            <section className="card">
              <h2>Produtos vendidos (por produto e tamanho)</h2>
              <SimpleTable
                rows={r.items}
                empty="Nenhum item"
                cols={[
                  { label: 'Produto', render: (i: any) => <>{i.product}{i.variant ? ` (${i.variant})` : ''} <small className="muted">{i.category}</small></> },
                  { label: 'Qtd', right: true, render: (i: any) => i.qty },
                  { label: 'Receita', right: true, render: (i: any) => <Money cents={i.revenue} /> },
                  { label: 'Custo', right: true, render: (i: any) => (i.missing_cost > 0 ? <span className="badge orange">incompleto</span> : <Money cents={i.cost} />) },
                  { label: 'Margem', right: true, render: (i: any) => (i.missing_cost > 0 ? '—' : <Money cents={i.revenue - (i.cost ?? 0)} />) },
                ]}
              />
              <h3 style={{ marginTop: 12 }}>Por categoria</h3>
              <SimpleTable
                rows={r.byCategory}
                empty="—"
                cols={[
                  { label: 'Categoria', render: (c: any) => c.category },
                  { label: 'Qtd', right: true, render: (c: any) => c.qty },
                  { label: 'Receita', right: true, render: (c: any) => <Money cents={c.revenue} /> },
                ]}
              />
            </section>

            <div className="grid cols-2">
              <section className="card">
                <h2>Bairros e taxas</h2>
                <SimpleTable
                  rows={r.byNeighborhood}
                  empty="Sem entregas"
                  cols={[
                    { label: 'Bairro', render: (n: any) => n.neighborhood },
                    { label: 'Pedidos', right: true, render: (n: any) => n.orders },
                    { label: 'Taxas', right: true, render: (n: any) => <Money cents={n.fees} /> },
                    { label: 'Total', right: true, render: (n: any) => <Money cents={n.total} /> },
                  ]}
                />
              </section>
              <section className="card">
                <h2>Entregadores</h2>
                <SimpleTable
                  rows={r.couriers}
                  empty="Sem entregas"
                  cols={[
                    { label: 'Entregador', render: (c: any) => c.courier },
                    { label: 'Entregas', right: true, render: (c: any) => c.deliveries },
                    { label: 'Repasse', right: true, render: (c: any) => <Money cents={c.fees_owed} /> },
                    { label: 'Tempo médio', right: true, render: (c: any) => (c.avg_minutes != null ? `${c.avg_minutes} min` : '—') },
                    { label: 'Ocorr.', right: true, render: (c: any) => c.issues },
                  ]}
                />
              </section>
            </div>

            <section className="card">
              <h2>Estoque baixo</h2>
              {r.lowStock.length === 0 ? <Empty title="Nenhum item abaixo do mínimo" /> : r.lowStock.map((s: any) => <div key={s.id}>{s.name}: {Number(s.quantity).toLocaleString('pt-BR')} {s.unit} (mín. {Number(s.minQuantity).toLocaleString('pt-BR')})</div>)}
            </section>

            {can('data.export') && (
              <section className="card">
                <h2>Exportar (CSV para Excel/Planilhas)</h2>
                <div className="hstack">
                  {[
                    ['orders', 'Pedidos'],
                    ['items', 'Itens'],
                    ['payments', 'Pagamentos'],
                    ['cash', 'Movimentos de caixa'],
                    ['deliveries', 'Entregas'],
                    ['expenses', 'Despesas'],
                  ].map(([k, l]) => (
                    <a key={k} className="btn" href={exportUrl(k!)} download>
                      {l}
                    </a>
                  ))}
                </div>
                <small className="muted">As exportações ficam registradas na auditoria. Contêm dados pessoais: guarde com cuidado.</small>
              </section>
            )}
          </>
        )
      )}
    </Layout>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{formatBRL(value)}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function SimpleTable<T>({ rows, cols, empty }: { rows: T[]; cols: { label: string; right?: boolean; render: (r: T) => React.ReactNode }[]; empty: string }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{cols.map((c) => <th key={c.label} className={c.right ? 'right' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c.label} className={c.right ? 'right' : ''}>{c.render(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
