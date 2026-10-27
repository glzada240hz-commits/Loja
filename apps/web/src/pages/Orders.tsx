import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatPhoneBR, ORDER_TYPE_LABEL, type OrderType } from '@guto/core';
import { Layout } from '../components/Layout';
import { OrderDrawer } from '../components/OrderDrawer';
import { DeliveryBadge, StageBadge, StatusBadge, TypeBadge } from '../components/status';
import { Chips, Empty, ErrorBox, Loading, Money } from '../components/ui';
import { get, qs } from '../lib/api';
import { formatTime, formatDate } from '../lib/format';
import { useDay } from '../lib/queries';
import type { OrderRow } from '../lib/types';

type Filter = 'active' | 'pending' | 'closed' | 'cancelled' | 'receivable' | 'all';

export default function Orders() {
  const { id } = useParams();
  const nav = useNavigate();
  const day = useDay();
  const [filter, setFilter] = useState<Filter>('active');
  const [type, setType] = useState<OrderType | ''>('');
  const [q, setQ] = useState('');
  const [allDays, setAllDays] = useState(false);
  const dayId = day.data?.day?.id;
  const status = { active: 'pending,open', pending: 'pending', closed: 'closed', cancelled: 'cancelled', receivable: '', all: '' }[filter];
  const list = useQuery({
    queryKey: ['orders', filter, type, q, allDays, dayId],
    queryFn: () =>
      get<OrderRow[]>(
        '/api/orders' +
          qs({ status, type, q: q.trim(), receivable: filter === 'receivable' ? 1 : undefined, dayId: allDays || filter === 'receivable' || q.trim() ? undefined : dayId }),
      ),
    enabled: day.isSuccess,
    refetchInterval: 30000,
  });
  return (
    <Layout title="Pedidos">
      <div className="page-head">
        <input type="search" placeholder="Buscar número, cliente, telefone ou endereço" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 420 }} aria-label="Buscar pedidos" />
        <label className="check">
          <input type="checkbox" checked={allDays} onChange={(e) => setAllDays(e.target.checked)} /> Todos os dias
        </label>
        <div className="grow" />
        <select value={type} onChange={(e) => setType(e.target.value as OrderType)} aria-label="Tipo" style={{ width: 'auto' }}>
          <option value="">Todos os tipos</option>
          {(['counter', 'takeout', 'delivery', 'table'] as const).map((t) => (
            <option key={t} value={t}>
              {ORDER_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <Chips
        label="Situação"
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'active', label: 'Em andamento' },
          { id: 'pending', label: 'Aguardando aceite' },
          { id: 'closed', label: 'Finalizados' },
          { id: 'cancelled', label: 'Cancelados' },
          { id: 'receivable', label: 'Contas pendentes' },
          { id: 'all', label: 'Todos' },
        ]}
      />
      <div style={{ height: 12 }} />
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox error={list.error} retry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <Empty title="Nenhum pedido encontrado">{!dayId && !allDays ? 'O dia operacional está fechado.' : null}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Hora</th>
                <th>Tipo</th>
                <th>Cliente</th>
                <th>Situação</th>
                <th className="right">Total</th>
                <th className="right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => nav(`/pedidos/${o.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/pedidos/${o.id}`)}>
                  <td>
                    <b>#{o.number}</b>
                    {allDays && <div><small className="muted">{formatDate(o.referenceDate + 'T12:00:00')}</small></div>}
                  </td>
                  <td className="num">{formatTime(o.createdAt)}</td>
                  <td>
                    <TypeBadge type={o.type} table={o.tableLabel} tabKind={o.tabKind} />
                    {o.source === 'online' && <span className="badge blue">online</span>}
                  </td>
                  <td>
                    {o.customerName ?? '—'}
                    {o.customerPhone && <div><small className="muted">{formatPhoneBR(o.customerPhone)}</small></div>}
                    {o.addrStreet && <div><small className="muted">{o.addrStreet}, {o.addrNumber} — {o.neighborhoodName}</small></div>}
                  </td>
                  <td>
                    <div className="hstack">
                      <StatusBadge status={o.status} />
                      {o.status === 'open' && <StageBadge stage={o.stage} />}
                      {o.deliveryStatus && o.status === 'open' && <DeliveryBadge status={o.deliveryStatus} />}
                      {o.receivable && o.totalCents > o.paidCents && <span className="badge red">pendente</span>}
                    </div>
                    {o.courierName && <small className="muted">🛵 {o.courierName}</small>}
                  </td>
                  <td className="right">
                    <Money cents={o.totalCents} />
                  </td>
                  <td className="right">{o.totalCents - o.paidCents > 0 && o.status !== 'cancelled' ? <Money cents={o.totalCents - o.paidCents} /> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {id && <OrderDrawer orderId={id} onClose={() => nav('/pedidos')} />}
    </Layout>
  );
}
