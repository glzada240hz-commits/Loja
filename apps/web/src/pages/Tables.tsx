import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Hash, LayoutGrid, Plus, ReceiptText, Utensils } from 'lucide-react';
import { formatBRL, placeLabel } from '@guto/core';
import { Layout } from '../components/Layout';
import { OrderDrawer } from '../components/OrderDrawer';
import { Button, Empty, ErrorBox, Loading, Segmented } from '../components/ui';
import { get, qs } from '../lib/api';
import { elapsedLabel, minutesSince, shortName } from '../lib/format';
import { useDay, useSettings } from '../lib/queries';
import type { OrderRow } from '../lib/types';

export function Progress({ r }: { r: OrderRow['rounds'] }) {
  if (!r) return null;
  const parts: [number, string, string][] = [
    [r.received, 'enviado', 'blue'],
    [r.preparing, 'em preparo', 'yellow'],
    [r.ready, 'pronto', 'green'],
    [r.served, 'entregue', ''],
  ];
  return (
    <span className="tbl-prog">
      {parts
        .filter(([n]) => n > 0)
        .map(([n, l, c]) => (
          <span key={l} className={'badge ' + c}>
            {n} {l}
          </span>
        ))}
    </span>
  );
}

type Filter = 'all' | 'busy' | 'free';
const stateOf = (o: OrderRow) => (o.billRequestedAt ? 'bill' : o.rounds?.ready ? 'ready' : 'busy');
const STATE_LABEL = { busy: 'Ocupada', ready: 'Servir', bill: 'Conta' } as const;
const LATE_MIN = 60;

/** Salão: mapa de mesas e comandas + fila do que precisa de atenção agora. Atualiza em tempo real. */
export default function Tables() {
  const settings = useSettings();
  const day = useDay();
  const nav = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const orders = useQuery({
    queryKey: ['tables', day.data?.day?.id],
    queryFn: () => get<OrderRow[]>('/api/orders' + qs({ type: 'table', status: 'open,pending', dayId: day.data?.day?.id })),
    enabled: !!day.data?.day,
    refetchInterval: 30000,
  });
  if (settings.isLoading || day.isLoading) return <Layout title="Mesas e comandas"><Loading /></Layout>;
  if (!day.data?.day)
    return (
      <Layout title="Mesas e comandas">
        <Empty icon={LayoutGrid} title="Dia operacional fechado">
          <span>Abra o dia em Caixa e dia para receber pedidos das mesas.</span>
        </Empty>
      </Layout>
    );
  const tables: string[] = settings.data?.tables ?? [];
  const list = orders.data ?? [];
  const tabs = list.filter((o) => o.tabKind === 'tab');
  const tableOrders = list.filter((o) => o.tabKind === 'table');
  const bills = list.filter((o) => o.billRequestedAt);
  const ready = list.filter((o) => !o.billRequestedAt && o.rounds?.ready);
  const oldest = [...list].filter((o) => !o.billRequestedAt && !o.rounds?.ready).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 5);
  const openTotal = list.reduce((a, o) => a + o.totalCents - o.paidCents, 0);
  const extraTables = tableOrders.filter((o) => !tables.includes(o.tableLabel ?? '')).map((o) => o.tableLabel ?? '?');
  const show = (o: OrderRow | undefined) => filter === 'all' || (filter === 'busy' && !!o) || (filter === 'free' && !o);

  const tile = (o: OrderRow | undefined, kind: 'table' | 'tab', label: string, onFree?: () => void) => {
    const name = `${kind === 'tab' ? 'Comanda' : 'Mesa'} ${label}`;
    if (!o)
      return (
        <button key={name} type="button" className="tbl free" onClick={onFree} aria-label={`${name}, livre`}>
          <span className="tbl-band">
            <span>Livre</span>
            <Plus className="icon" aria-hidden />
          </span>
          <span className="tbl-body">
            <span className="tbl-num">{label}</span>
          </span>
        </button>
      );
    const st = stateOf(o);
    const late = minutesSince(o.createdAt) >= LATE_MIN;
    const StIcon = st === 'bill' ? ReceiptText : st === 'ready' ? CheckCircle2 : Utensils;
    return (
      <button
        key={name + o.id}
        type="button"
        className={`tbl ${st}${late ? ' late' : ''}`}
        onClick={() => setOpen(o.id)}
        aria-label={`${name}, pedido ${o.number}, ${formatBRL(o.totalCents)}${o.billRequestedAt ? ', conta pedida' : ''}`}
      >
        <span className="tbl-band">
          <span>
            <StIcon className="icon" aria-hidden /> {STATE_LABEL[st]}
          </span>
          <span className="t-time">
            <Clock className="icon" aria-hidden /> {elapsedLabel(o.createdAt)}
          </span>
        </span>
        <span className="tbl-body">
          <span className="tbl-num">
            {kind === 'tab' && <small>#</small>}
            {label}
          </span>
          <Progress r={o.rounds} />
          <span className="tbl-amount">{formatBRL(o.totalCents)}</span>
          <span className="tbl-who" title={`Pedido #${o.number}`}>
            {shortName(o.createdByName)}
            {o.paidCents > 0 ? ` · pago ${formatBRL(o.paidCents)}` : ''}
          </span>
        </span>
      </button>
    );
  };

  const tableTiles = [
    ...tables.map((t) => ({ o: tableOrders.find((x) => x.tableLabel === t), t })),
    ...extraTables.map((t) => ({ o: tableOrders.find((x) => x.tableLabel === t), t })),
  ].filter(({ o }) => show(o));
  const tabTiles = tabs.filter((o) => show(o));

  const queueItem = (o: OrderRow, note: string) => (
    <button key={o.id} type="button" className="queue-item" onClick={() => setOpen(o.id)}>
      <b>{placeLabel(o)}</b>
      <span className="money">{formatBRL(o.totalCents - o.paidCents)}</span>
      <small className="muted">
        {note} · {shortName(o.createdByName)} · {elapsedLabel(o.createdAt)}
      </small>
    </button>
  );

  return (
    <Layout bare>
      <div className="floor">
        <div className="floor-main">
          <div className="floor-bar">
            <h1>Mesas e comandas</h1>
            <div className="floor-stats">
              <span>
                <b>{tableOrders.length}</b>de {tables.length} mesas ocupadas
              </span>
              <span>
                <b>{tabs.length}</b>comandas
              </span>
              <span>
                <b className="money">{formatBRL(openTotal)}</b>a receber
              </span>
            </div>
            <div className="floor-filter">
              <Segmented
                label="Filtrar"
                value={filter}
                onChange={setFilter}
                options={[
                  { id: 'all', label: 'Todas' },
                  { id: 'busy', label: 'Ocupadas' },
                  { id: 'free', label: 'Livres' },
                ]}
              />
            </div>
            <div className="floor-legend" aria-label="Legenda">
              <span><i className="free" /> Livre</span>
              <span><i className="busy" /> Ocupada</span>
              <span><i className="ready" /> Item pronto p/ servir</span>
              <span><i className="bill" /> Conta pedida</span>
            </div>
          </div>
          {orders.error && <ErrorBox error={orders.error} retry={() => orders.refetch()} />}
          <h2 className="floor-section">
            Mesas <span className="count">{tableOrders.length} ocupada(s)</span>
          </h2>
          {tables.length === 0 ? (
            <Empty title="Nenhuma mesa cadastrada">
              <Button onClick={() => nav('/ajustes')}>Cadastrar mesas em Ajustes</Button>
            </Empty>
          ) : tableTiles.length === 0 ? (
            <Empty compact title="Nenhuma mesa neste filtro" />
          ) : (
            <div className="tbl-grid">{tableTiles.map(({ o, t }) => tile(o, 'table', t, () => nav(`/pdv?tipo=table&mesa=${encodeURIComponent(t)}`)))}</div>
          )}
          <h2 className="floor-section">
            <Hash size={13} aria-hidden /> Comandas abertas <span className="count">({tabs.length})</span>
          </h2>
          {tabTiles.length === 0 ? (
            <Empty compact icon={Hash} title={tabs.length ? 'Nenhuma comanda neste filtro' : 'Nenhuma comanda aberta'}>
              <span>Comandas são abertas pelo app do atendente.</span>
            </Empty>
          ) : (
            <div className="tbl-grid">{tabTiles.map((o) => tile(o, 'tab', o.tableLabel ?? '?'))}</div>
          )}
        </div>
        <aside className="floor-aside" aria-label="Precisam de atenção">
          <h2>Precisam de atenção</h2>
          <div className="queue">
            <div className="queue-group">
              <h3>
                <i style={{ background: 'var(--bill)' }} /> Conta pedida ({bills.length})
              </h3>
              {bills.length ? bills.map((o) => queueItem(o, 'receber')) : <div className="queue-empty">Nenhuma conta pedida.</div>}
            </div>
            <div className="queue-group">
              <h3>
                <i style={{ background: 'var(--ok)' }} /> Pronto para servir ({ready.length})
              </h3>
              {ready.length ? ready.map((o) => queueItem(o, `${o.rounds?.ready} rodada(s) pronta(s)`)) : <div className="queue-empty">Nada pronto esperando.</div>}
            </div>
            <div className="queue-group">
              <h3>
                <i style={{ background: 'var(--info)' }} /> Abertas há mais tempo
              </h3>
              {oldest.length ? oldest.map((o) => queueItem(o, 'em atendimento')) : <div className="queue-empty">Nenhuma mesa aberta.</div>}
            </div>
          </div>
        </aside>
      </div>
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
    </Layout>
  );
}
