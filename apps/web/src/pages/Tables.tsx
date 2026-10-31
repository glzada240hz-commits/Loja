import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BellRing, CheckCircle2, Clock, Hash, LayoutGrid, Plus, ReceiptText, UserRound, Utensils } from 'lucide-react';
import { formatBRL } from '@guto/core';
import { Layout } from '../components/Layout';
import { OrderDrawer } from '../components/OrderDrawer';
import { Alert, Button, Chips, Empty, ErrorBox, Loading } from '../components/ui';
import { get, qs } from '../lib/api';
import { elapsedLabel, shortName } from '../lib/format';
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
    <span className="tbadges">
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

type Filter = 'all' | 'busy' | 'free' | 'attention';
const stateOf = (o: OrderRow) => (o.billRequestedAt ? 'bill' : o.rounds?.ready ? 'ready' : 'busy');

/** Mesas e comandas em tempo real: pedidos lançados pelos atendentes chegam aqui sem redigitar. */
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
  const openTotal = list.reduce((a, o) => a + o.totalCents - o.paidCents, 0);
  const extraTables = tableOrders.filter((o) => !tables.includes(o.tableLabel ?? '')).map((o) => o.tableLabel ?? '?');

  const show = (o: OrderRow | undefined) =>
    filter === 'all' || (filter === 'busy' && !!o) || (filter === 'free' && !o) || (filter === 'attention' && !!o && stateOf(o) !== 'busy');

  const tile = (o: OrderRow | undefined, kind: 'table' | 'tab', label: string, onFree?: () => void) => {
    const name = `${kind === 'tab' ? 'Comanda' : 'Mesa'} ${label}`;
    if (!o)
      return (
        <button key={name} type="button" className="table-tile free" onClick={onFree} aria-label={`${name}, livre`}>
          <span className="tkind">{kind === 'tab' ? 'Comanda' : 'Mesa'}</span>
          <span className="tnum">{label}</span>
          <span className="tfree">
            <Plus size={14} aria-hidden /> Livre · abrir pelo caixa
          </span>
        </button>
      );
    const st = stateOf(o);
    const StIcon = st === 'bill' ? ReceiptText : st === 'ready' ? CheckCircle2 : Utensils;
    return (
      <button
        key={name + o.id}
        type="button"
        className={`table-tile ${st}${kind === 'tab' ? ' tab' : ''}`}
        onClick={() => setOpen(o.id)}
        aria-label={`${name}, pedido ${o.number}, ${formatBRL(o.totalCents)}${o.billRequestedAt ? ', conta pedida' : ''}`}
      >
        <span className="tile-top">
          <span className="tkind">
            {kind === 'tab' ? <Hash aria-hidden className="icon" /> : null}
            {kind === 'tab' ? 'Comanda' : 'Mesa'} · #{o.number}
          </span>
          <span className="tkind" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
            <Clock className="icon" aria-hidden /> {elapsedLabel(o.createdAt)}
          </span>
        </span>
        <span className="tnum">{label}</span>
        <span className="tline">
          <UserRound className="icon" aria-hidden />
          <span>{shortName(o.createdByName)}</span>
        </span>
        <span className="tbadges">
          {st === 'bill' && (
            <span className="badge violet">
              <StIcon className="icon" aria-hidden /> Conta pedida
            </span>
          )}
          {st === 'ready' && (
            <span className="badge green">
              <StIcon className="icon" aria-hidden /> Servir
            </span>
          )}
          <Progress r={o.rounds} />
        </span>
        <span className="tamount">
          {formatBRL(o.totalCents)}
          {o.paidCents > 0 && <small className="muted" style={{ fontWeight: 500 }}> · pago {formatBRL(o.paidCents)}</small>}
        </span>
      </button>
    );
  };

  const tableTiles = [
    ...tables.map((t) => ({ o: tableOrders.find((x) => x.tableLabel === t), t })),
    ...extraTables.map((t) => ({ o: tableOrders.find((x) => x.tableLabel === t), t })),
  ].filter(({ o }) => show(o));
  const tabTiles = tabs.filter((o) => show(o));

  return (
    <Layout title="Mesas e comandas">
      {orders.error && <ErrorBox error={orders.error} retry={() => orders.refetch()} />}
      <div className="kpis">
        <button type="button" className="kpi" onClick={() => setFilter('busy')}>
          <span className="kicon info"><Utensils className="icon" aria-hidden /></span>
          <span>
            <span className="kv">{tableOrders.length}<small className="muted" style={{ fontSize: '.8rem', fontWeight: 600 }}> / {tables.length}</small></span>
            <span className="kl" style={{ display: 'block' }}>Mesas ocupadas</span>
          </span>
        </button>
        <button type="button" className="kpi" onClick={() => setFilter('busy')}>
          <span className="kicon neutral"><Hash className="icon" aria-hidden /></span>
          <span>
            <span className="kv">{tabs.length}</span>
            <span className="kl" style={{ display: 'block' }}>Comandas abertas</span>
          </span>
        </button>
        <button type="button" className="kpi" onClick={() => setFilter('attention')}>
          <span className="kicon bill"><ReceiptText className="icon" aria-hidden /></span>
          <span>
            <span className="kv">{bills.length}</span>
            <span className="kl" style={{ display: 'block' }}>Contas pedidas · {ready.length} p/ servir</span>
          </span>
        </button>
        <div className="kpi">
          <span className="kicon ok"><BellRing className="icon" aria-hidden /></span>
          <span>
            <span className="kv money">{formatBRL(openTotal)}</span>
            <span className="kl" style={{ display: 'block' }}>A receber em mesas e comandas</span>
          </span>
        </div>
      </div>
      {bills.length > 0 && (
        <Alert kind="bill" icon={ReceiptText} role="status">
          <b>Conta pedida:</b>{' '}
          <span className="hstack" style={{ display: 'inline-flex', marginLeft: 4 }}>
            {bills.map((o) => (
              <Button key={o.id} size="sm" onClick={() => setOpen(o.id)}>
                {o.tabKind === 'tab' ? 'Comanda' : 'Mesa'} {o.tableLabel} · {formatBRL(o.totalCents - o.paidCents)}
              </Button>
            ))}
          </span>
        </Alert>
      )}
      <div className="tables-toolbar">
        <Chips
          label="Filtrar mesas"
          value={filter}
          onChange={setFilter}
          scroll
          options={[
            { id: 'all', label: 'Todas' },
            { id: 'busy', label: 'Ocupadas' },
            { id: 'attention', label: 'Precisam de atenção' },
            { id: 'free', label: 'Livres' },
          ]}
        />
        <div className="grow" />
        <div className="legend" aria-label="Legenda">
          <span><i className="free" /> Livre</span>
          <span><i className="busy" /> Em atendimento</span>
          <span><i className="ready" /> Item pronto p/ servir</span>
          <span><i className="bill" /> Conta pedida</span>
        </div>
      </div>
      <h2 className="section-title">
        <LayoutGrid size={18} aria-hidden /> Mesas <span className="count">{tableOrders.length} ocupada(s)</span>
      </h2>
      {tables.length === 0 ? (
        <Empty title="Nenhuma mesa cadastrada">
          <Button onClick={() => nav('/ajustes')}>Cadastrar mesas em Ajustes</Button>
        </Empty>
      ) : tableTiles.length === 0 ? (
        <Empty compact title="Nenhuma mesa neste filtro" />
      ) : (
        <div className="tables-grid">{tableTiles.map(({ o, t }) => tile(o, 'table', t, () => nav(`/pdv?tipo=table&mesa=${encodeURIComponent(t)}`)))}</div>
      )}
      <h2 className="section-title" style={{ marginTop: 24 }}>
        <Hash size={18} aria-hidden /> Comandas abertas <span className="count">({tabs.length})</span>
      </h2>
      {tabTiles.length === 0 ? (
        <Empty compact icon={Hash} title={tabs.length ? 'Nenhuma comanda neste filtro' : 'Nenhuma comanda aberta'}>
          <span>Comandas são abertas pelo app do atendente (aba “Comandas”).</span>
        </Empty>
      ) : (
        <div className="tables-grid">{tabTiles.map((o) => tile(o, 'tab', o.tableLabel ?? '?'))}</div>
      )}
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
    </Layout>
  );
}
