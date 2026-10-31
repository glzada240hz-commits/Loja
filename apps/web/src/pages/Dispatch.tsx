import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBRL, formatPhoneBR, mapsLink, PAYMENT_METHOD_LABEL } from '@guto/core';
import { Layout } from '../components/Layout';
import { OrderDrawer } from '../components/OrderDrawer';
import { DeliveryBadge, StageBadge } from '../components/status';
import { Bike, Clock, MapPin, X } from 'lucide-react';
import { Alert, Button, Empty, ErrorBox, Field, Loading, Modal, Money, MoneyInput, Tabs, useAction, useUi } from '../components/ui';
import { get, newIdemKey, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatTime, minutesSince } from '../lib/format';

interface BoardOrder {
  id: string; number: number; status: string; stage: any; customerName: string | null; customerPhone: string | null;
  addrStreet: string | null; addrNumber: string | null; addrComplement: string | null; addrReference: string | null; neighborhoodName: string | null;
  totalCents: number; paidCents: number; deliveryFeeCents: number; courierFeeCents: number | null; paymentIntent: any; changeForCents: number | null;
  deliveryStatus: any; deliveryIssue: string | null; courierId: string | null; courierName: string | null; deliveryRunId: string | null;
  createdAt: string; readyAt: string | null; dispatchedAt: string | null; deliveredAt: string | null; etaAt: string | null; notes: string | null;
}
interface Run { id: string; courierId: string; courierName: string; status: string; createdAt: string; departedAt: string | null }

export default function Dispatch() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'board' | 'settle'>('board');
  return (
    <Layout title="Entregas">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'board', label: 'Expedição' }, ...(can('couriers.settle') ? [{ id: 'settle' as const, label: 'Acertos com entregadores' }] : [])]} />
      {tab === 'board' ? <Board /> : <Settlements />}
    </Layout>
  );
}

function Board() {
  const qc = useQueryClient();
  const ui = useUi();
  const board = useQuery({ queryKey: ['deliveries'], queryFn: () => get<{ orders: BoardOrder[]; runs: Run[] }>('/api/deliveries'), refetchInterval: 30000 });
  const couriers = useQuery({ queryKey: ['couriers'], queryFn: () => get<any[]>('/api/couriers') });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [courierId, setCourier] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { busy, go } = useAction();
  const refresh = () => qc.invalidateQueries({ queryKey: ['deliveries'] });

  if (board.isLoading) return <Loading />;
  if (board.error) return <ErrorBox error={board.error} retry={() => board.refetch()} />;
  const orders = board.data!.orders.filter((o) => o.status !== 'cancelled');
  // prontos primeiro: são os que podem sair agora
  const waiting = orders.filter((o) => o.deliveryStatus === 'waiting' && !o.courierId).sort((a, b) => Number(b.stage === 'ready') - Number(a.stage === 'ready'));
  const enRoute = orders.filter((o) => o.deliveryStatus === 'en_route' || o.deliveryStatus === 'issue');
  const done = orders.filter((o) => o.deliveryStatus === 'delivered');

  const assign = () =>
    go(async () => {
      await post('/api/deliveries/assign', { orderIds: [...sel], courierId });
      setSel(new Set());
      await refresh();
    }, { success: 'Entregas atribuídas' });

  const setStatus = async (o: BoardOrder, status: string) => {
    let note: string | null = null;
    if (status === 'issue') {
      const r = await ui.confirm({ title: `Ocorrência no pedido #${o.number}`, reasonLabel: 'O que aconteceu?', confirmLabel: 'Registrar' });
      if (typeof r !== 'string') return;
      note = r;
    }
    if (status === 'waiting') {
      const ok = await ui.confirm({ title: `Pedido #${o.number} voltou para a loja?`, message: 'Ele volta para a fila de expedição sem entregador.' });
      if (!ok) return;
    }
    await go(async () => {
      await post(`/api/deliveries/${o.id}/status`, { status, note });
      await refresh();
    });
  };

  const card = (o: BoardOrder, extra?: React.ReactNode) => (
    <div key={o.id} className={'dispatch-card' + (sel.has(o.id) ? ' selected' : '')}>
      <span style={{ paddingTop: 6 }}>{extra}</span>
      <div style={{ minWidth: 0 }}>
        <div className="hstack">
          <button type="button" className="btn ghost sm" style={{ paddingLeft: 4, paddingRight: 4 }} onClick={() => setOpen(o.id)}>
            <b>#{o.number}</b>
          </button>
          <StageBadge stage={o.stage} />
          {o.deliveryStatus && o.deliveryStatus !== 'waiting' && <DeliveryBadge status={o.deliveryStatus} />}
          <span className="spacer" />
          <small className="muted hstack" style={{ gap: 4 }}>
            <Clock size={13} aria-hidden /> {minutesSince(o.createdAt)} min{o.etaAt ? ` · prev. ${formatTime(o.etaAt)}` : ''}
          </small>
        </div>
        <div style={{ marginTop: 4, fontWeight: 600 }}>
          <MapPin size={14} aria-hidden style={{ verticalAlign: -2, color: 'var(--muted)' }} /> {o.neighborhoodName} — {o.addrStreet}, {o.addrNumber}
          {o.addrComplement ? ` (${o.addrComplement})` : ''}{' '}
          <a href={mapsLink(`${o.addrStreet}, ${o.addrNumber} - ${o.neighborhoodName}`)} target="_blank" rel="noreferrer" style={{ fontWeight: 500, fontSize: '.85rem' }}>
            mapa
          </a>
        </div>
        <small className="muted" style={{ display: 'block' }}>
          {o.customerName} · {formatPhoneBR(o.customerPhone)}
        </small>
        <div className="fee-split" style={{ marginTop: 6 }}>
          <span>
            Cobrar <b>{formatBRL(o.totalCents - o.paidCents)}</b>
            {o.paymentIntent ? ` (${PAYMENT_METHOD_LABEL[o.paymentIntent as keyof typeof PAYMENT_METHOD_LABEL]})` : ''}
            {o.changeForCents ? ` · troco p/ ${formatBRL(o.changeForCents)}` : ''}
          </span>
          <span>
            Taxa do cliente <b>{formatBRL(o.deliveryFeeCents)}</b>
          </span>
          <span>
            Repasse ao motoboy <b>{o.courierFeeCents != null ? formatBRL(o.courierFeeCents) : 'ao atribuir'}</b>
          </span>
        </div>
        {o.deliveryIssue && o.deliveryStatus === 'issue' && (
          <div style={{ marginTop: 6 }}>
            <Alert kind="error">{o.deliveryIssue}</Alert>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="grid cols-3">
        <section>
          <h2>Aguardando entregador ({waiting.length})</h2>
          {waiting.length > 0 && (
            <div className="card" style={{ marginBottom: 10 }}>
              <div className="row">
                <Field label="Entregador">
                  <select value={courierId} onChange={(e) => setCourier(e.target.value)}>
                    <option value="">Selecione…</option>
                    {couriers.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button className="shrink" variant="primary" busy={busy} disabled={!courierId || sel.size === 0} onClick={assign}>
                  Atribuir {sel.size || ''}
                </Button>
              </div>
              <small className="muted">Marque um ou mais pedidos para agrupar na mesma saída.</small>
            </div>
          )}
          {waiting.length === 0 && <Empty title="Nenhuma entrega aguardando" />}
          <div className="stack">
            {waiting.map((o) =>
              card(
                o,
                <input
                  type="checkbox"
                  aria-label={`Selecionar pedido ${o.number}`}
                  checked={sel.has(o.id)}
                  onChange={(e) => {
                    const n = new Set(sel);
                    if (e.target.checked) n.add(o.id);
                    else n.delete(o.id);
                    setSel(n);
                  }}
                />,
              ),
            )}
          </div>
        </section>
        <section>
          <h2>Saídas montadas</h2>
          {board.data!.runs.filter((r) => r.status === 'assigned').length === 0 && <Empty title="Nenhuma saída aguardando" />}
          <div className="stack">
            {board.data!.runs
              .filter((r) => r.status === 'assigned')
              .map((r) => {
                const list = orders.filter((o) => o.deliveryRunId === r.id && o.deliveryStatus === 'waiting');
                const notReady = list.filter((o) => o.stage !== 'ready');
                return (
                  <div key={r.id} className="card" style={{ borderColor: 'var(--brand)' }}>
                    <div className="hstack">
                      <b className="hstack" style={{ gap: 6 }}><Bike size={18} aria-hidden /> {r.courierName}</b>
                      <span className="badge">{list.length} pedido(s)</span>
                    </div>
                    <div className="stack" style={{ margin: '8px 0' }}>
                      {list.map((o) =>
                        card(
                          o,
                          <Button size="sm" variant="ghost" aria-label={`Remover pedido ${o.number} da saída`} icon={X} onClick={() => go(async () => { await post(`/api/deliveries/${o.id}/unassign`, {}); await refresh(); })} />,
                        ),
                      )}
                    </div>
                    {notReady.length > 0 && <small className="muted">Aguardando cozinha: {notReady.map((o) => '#' + o.number).join(', ')}</small>}
                    <Button variant="dark" block busy={busy} disabled={notReady.length > 0 || list.length === 0} onClick={() => go(async () => { await post(`/api/deliveries/runs/${r.id}/depart`, {}); await refresh(); }, { success: 'Saída registrada' })}>
                      Saiu para entrega
                    </Button>
                  </div>
                );
              })}
          </div>
        </section>
        <section>
          <h2>Em rota ({enRoute.length})</h2>
          {enRoute.length === 0 && <Empty title="Nenhuma entrega em rota" />}
          <div className="stack">
            {enRoute.map((o) => (
              <div key={o.id}>
                {card(o)}
                <div className="hstack" style={{ marginTop: 4 }}>
                  <small className="muted">
                    <Bike size={13} aria-hidden style={{ verticalAlign: -2 }} /> {o.courierName} · saiu {formatTime(o.dispatchedAt)}
                  </small>
                  <span className="spacer" />
                  <Button size="sm" variant="success" onClick={() => setStatus(o, 'delivered')}>
                    Entregue
                  </Button>
                  {o.deliveryStatus !== 'issue' && (
                    <Button size="sm" onClick={() => setStatus(o, 'issue')}>
                      Ocorrência
                    </Button>
                  )}
                  {o.deliveryStatus === 'issue' && (
                    <Button size="sm" onClick={() => setStatus(o, 'waiting')}>
                      Voltou à loja
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <h2 style={{ marginTop: 16 }}>Entregues hoje ({done.length})</h2>
          {done.map((o) => (
            <div key={o.id} className="hstack" style={{ padding: '4px 0' }}>
              <button type="button" className="btn ghost sm" onClick={() => setOpen(o.id)}>
                #{o.number}
              </button>
              <small>
                {o.courierName} · {formatTime(o.deliveredAt)}
                {o.dispatchedAt && o.deliveredAt ? ` · ${minutesSince(o.dispatchedAt, new Date(o.deliveredAt).getTime())} min em rota` : ''}
              </small>
              <span className="spacer" />
              {o.totalCents - o.paidCents > 0 ? <span className="badge red">receber {formatBRL(o.totalCents - o.paidCents)}</span> : <span className="badge green">pago</span>}
            </div>
          ))}
        </section>
      </div>
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Settlements() {
  const couriers = useQuery({ queryKey: ['couriers'], queryFn: () => get<any[]>('/api/couriers') });
  const history = useQuery({ queryKey: ['settlements'], queryFn: () => get<any[]>('/api/settlements') });
  const [cid, setCid] = useState<string | null>(null);
  return (
    <div className="grid cols-2">
      <section>
        <h2>Entregadores</h2>
        {couriers.isLoading && <Loading />}
        <div className="stack">
          {couriers.data?.map((c) => (
            <CourierPendingCard key={c.id} courier={c} open={cid === c.id} onToggle={() => setCid(cid === c.id ? null : c.id)} />
          ))}
        </div>
      </section>
      <section>
        <h2>Acertos realizados</h2>
        {history.data?.length === 0 && <Empty title="Nenhum acerto ainda" />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Entregador</th>
                <th className="right">Entregas</th>
                <th className="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((s) => (
                <tr key={s.id}>
                  <td>{formatDateTime(s.createdAt)}</td>
                  <td>
                    {s.courierName}
                    {s.paidFromCash && <div><small className="muted">pago pelo caixa</small></div>}
                  </td>
                  <td className="right">{s.deliveriesCount}</td>
                  <td className="right">
                    <Money cents={s.totalCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CourierPendingCard({ courier, open, onToggle }: { courier: any; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const p = useQuery({ queryKey: ['courierPending', courier.id], queryFn: () => get<any>(`/api/couriers/${courier.id}/pending`) });
  const [adj, setAdj] = useState<null | 'bonus' | 'deduction'>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [fromCash, setFromCash] = useState(true);
  const { busy, go } = useAction();
  const ui = useUi();
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['courierPending', courier.id] });
    void qc.invalidateQueries({ queryKey: ['settlements'] });
  };
  const d = p.data;
  return (
    <div className="card">
      <div className="hstack">
        <b>{courier.name}</b>
        <span className="spacer" />
        {d && (
          <span>
            {d.deliveriesCount} entrega(s) · <b>{formatBRL(d.totalCents)}</b>
          </span>
        )}
        <Button size="sm" onClick={onToggle}>
          {open ? 'Fechar' : 'Detalhar'}
        </Button>
      </div>
      {open && d && (
        <div style={{ marginTop: 10 }}>
          <div className="totals">
            <span>Repasses de entregas ({d.deliveriesCount})</span>
            <Money cents={d.feesCents} />
            <span>Bônus e descontos</span>
            <Money cents={d.adjustmentsCents} />
            <b>Total a pagar</b>
            <b className="num">{formatBRL(d.totalCents)}</b>
          </div>
          <small className="muted">A taxa cobrada do cliente é registrada separadamente do repasse ao entregador.</small>
          <ul style={{ paddingLeft: 18 }}>
            {d.deliveries.map((x: any) => (
              <li key={x.id}>
                #{x.number} · {x.neighborhoodName} · {formatTime(x.deliveredAt)} · {formatBRL(x.fee ?? 0)}
              </li>
            ))}
            {d.adjustments.map((a: any) => (
              <li key={a.id}>
                {a.type === 'bonus' ? 'Bônus' : 'Desconto'}: {formatBRL(a.amountCents)} — {a.reason}
              </li>
            ))}
          </ul>
          <div className="hstack">
            <Button size="sm" onClick={() => setAdj('bonus')}>
              + Bônus
            </Button>
            <Button size="sm" onClick={() => setAdj('deduction')}>
              − Desconto/adiantamento
            </Button>
            <span className="spacer" />
            <label className="check">
              <input type="checkbox" checked={fromCash} onChange={(e) => setFromCash(e.target.checked)} /> pagar com dinheiro do caixa
            </label>
            <Button
              variant="primary"
              busy={busy}
              disabled={d.totalCents < 0 || (d.deliveriesCount === 0 && d.adjustments.length === 0)}
              onClick={async () => {
                const ok = await ui.confirm({ title: `Confirmar acerto com ${courier.name}`, message: `Total ${formatBRL(d.totalCents)}${fromCash ? ' — sai do caixa como "repasse a entregador"' : ''}.`, confirmLabel: 'Confirmar acerto' });
                if (!ok) return;
                await go(async () => {
                  await post(`/api/couriers/${courier.id}/settle`, { paidFromCash: fromCash, expectedTotalCents: d.totalCents }, { idempotencyKey: newIdemKey() });
                  reload();
                }, { success: 'Acerto registrado' });
              }}
            >
              Fazer acerto
            </Button>
          </div>
        </div>
      )}
      {adj && (
        <Modal
          title={adj === 'bonus' ? 'Bônus ao entregador' : 'Desconto / adiantamento'}
          onClose={() => setAdj(null)}
          footer={
            <Button
              variant="primary"
              busy={busy}
              disabled={!amount || !reason.trim()}
              onClick={() =>
                go(async () => {
                  await post(`/api/couriers/${courier.id}/adjustments`, { type: adj, amountCents: amount, reason });
                  setAdj(null);
                  setAmount(null);
                  setReason('');
                  reload();
                })
              }
            >
              Salvar
            </Button>
          }
        >
          <Field label="Valor">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Motivo">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
