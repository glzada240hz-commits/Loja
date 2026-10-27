import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatBRL } from '@guto/core';
import { Layout } from '../components/Layout';
import { OrderDrawer } from '../components/OrderDrawer';
import { Button, Empty, ErrorBox, Loading } from '../components/ui';
import { get, qs } from '../lib/api';
import { minutesSince } from '../lib/format';
import { useDay, useSettings } from '../lib/queries';
import type { OrderRow } from '../lib/types';

function Progress({ r }: { r: OrderRow['rounds'] }) {
  if (!r) return null;
  const parts: [number, string, string][] = [
    [r.received, 'enviado', 'blue'],
    [r.preparing, 'em preparo', 'yellow'],
    [r.ready, 'pronto', 'green'],
    [r.served, 'entregue', 'dark'],
  ];
  return (
    <span className="hstack" style={{ gap: 4 }}>
      {parts.filter(([n]) => n > 0).map(([n, l, c]) => (
        <span key={l} className={'badge ' + c}>
          {n} {l}
        </span>
      ))}
    </span>
  );
}

/** Mesas e comandas em tempo real: pedidos lançados pelos atendentes chegam aqui sem redigitar. */
export default function Tables() {
  const settings = useSettings();
  const day = useDay();
  const nav = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ['tables', day.data?.day?.id],
    queryFn: () => get<OrderRow[]>('/api/orders' + qs({ type: 'table', status: 'open,pending', dayId: day.data?.day?.id })),
    enabled: !!day.data?.day,
    refetchInterval: 30000,
  });
  if (settings.isLoading || day.isLoading) return <Layout title="Mesas e comandas"><Loading /></Layout>;
  if (!day.data?.day) return <Layout title="Mesas e comandas"><Empty title="Dia operacional fechado" /></Layout>;
  const tables: string[] = settings.data?.tables ?? [];
  const list = orders.data ?? [];
  const tabs = list.filter((o) => o.tabKind === 'tab');
  const bills = list.filter((o) => o.billRequestedAt);

  const tile = (o: OrderRow | undefined, label: string, onFree?: () => void) => (
    <button
      key={label}
      type="button"
      className={'table-tile' + (o ? (o.billRequestedAt ? ' bill' : o.rounds?.ready ? ' ready' : ' busy') : '')}
      onClick={() => (o ? setOpen(o.id) : onFree?.())}
      aria-label={o ? `${label}, pedido ${o.number}, ${formatBRL(o.totalCents)}${o.billRequestedAt ? ', conta pedida' : ''}` : `${label}, livre`}
    >
      <span className="tnum">{label}</span>
      {o ? (
        <>
          <span>
            #{o.number} · {minutesSince(o.createdAt)} min · {o.createdByName ?? '—'}
          </span>
          <b>{formatBRL(o.totalCents)}</b>
          {o.paidCents > 0 && <small>pago {formatBRL(o.paidCents)}</small>}
          <Progress r={o.rounds} />
          {o.billRequestedAt && <span className="badge red">Conta pedida</span>}
        </>
      ) : (
        <span className="muted">Livre</span>
      )}
    </button>
  );

  return (
    <Layout title="Mesas e comandas">
      {orders.error && <ErrorBox error={orders.error} retry={() => orders.refetch()} />}
      {bills.length > 0 && (
        <div className="alert warn" role="status">
          <b>Pedidos de conta:</b>{' '}
          {bills.map((o) => (
            <button key={o.id} type="button" className="btn sm" style={{ marginLeft: 6 }} onClick={() => setOpen(o.id)}>
              {o.tabKind === 'tab' ? 'Comanda' : 'Mesa'} {o.tableLabel} · {formatBRL(o.totalCents - o.paidCents)}
            </button>
          ))}
        </div>
      )}
      <p className="muted">Pedidos lançados no app dos atendentes aparecem aqui automaticamente. Toque numa mesa livre para abrir pelo caixa.</p>
      <h2>Mesas</h2>
      <div className="tables-grid">
        {tables.map((t) => tile(list.find((x) => x.tabKind === 'table' && x.tableLabel === t), `Mesa ${t}`, () => nav(`/pdv?tipo=table&mesa=${encodeURIComponent(t)}`)))}
        {/* mesas abertas com rótulo que não está na lista configurada */}
        {list.filter((o) => o.tabKind === 'table' && !tables.includes(o.tableLabel ?? '')).map((o) => tile(o, `Mesa ${o.tableLabel}`))}
      </div>
      {tables.length === 0 && (
        <Empty title="Nenhuma mesa cadastrada">
          <Button onClick={() => nav('/ajustes')}>Cadastrar mesas em Ajustes</Button>
        </Empty>
      )}
      <h2 style={{ marginTop: 16 }}>Comandas abertas ({tabs.length})</h2>
      {tabs.length === 0 ? <Empty title="Nenhuma comanda aberta" /> : <div className="tables-grid">{tabs.map((o) => tile(o, `Comanda ${o.tableLabel}`))}</div>}
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
    </Layout>
  );
}
