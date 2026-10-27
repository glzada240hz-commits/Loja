import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_STATUS_LABEL, ORDER_TYPE_LABEL, type KitchenStatus } from '@guto/core';
import { Layout } from '../components/Layout';
import { Button, Empty, ErrorBox, Loading, useAction } from '../components/ui';
import { get, post } from '../lib/api';
import { formatTime, minutesSince } from '../lib/format';

interface KTicket {
  id: string;
  orderId: string;
  round: number;
  status: KitchenStatus;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  changedAt: string | null;
  changeNote: string | null;
  orderNumber: number;
  orderType: 'counter' | 'takeout' | 'delivery' | 'table';
  orderStatus: string;
  tableLabel: string | null;
  place: string;
  createdByName: string | null;
  customerName: string | null;
  orderNotes: string | null;
  etaAt: string | null;
  source: string;
  items: { id: string; productName: string; variantName: string | null; quantity: number; notes: string | null; status: string; comboComponents: any; options: { name: string; group: string; quantity: number }[] }[];
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.15;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* sem áudio */
  }
}

export default function Kitchen() {
  const q = useQuery({ queryKey: ['kitchen'], queryFn: () => get<{ lateMinutes: number; tickets: KTicket[] }>('/api/kitchen'), refetchInterval: 20000 });
  const [, tick] = useState(0);
  const [sound, setSound] = useState(() => localStorageGet('kds-sound') !== '0');
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!q.data) return;
    const ids = new Set(q.data.tickets.map((t) => t.id));
    if (known.current && sound && [...ids].some((id) => !known.current!.has(id))) beep();
    known.current = ids;
  }, [q.data, sound]);

  const tickets = q.data?.tickets ?? [];
  const cols: { status: KitchenStatus; title: string }[] = [
    { status: 'received', title: 'Recebidos' },
    { status: 'preparing', title: 'Em preparo' },
    { status: 'ready', title: 'Prontos (últimos 20 min)' },
  ];
  return (
    <div className="kds">
      <Layout
        title="Cozinha"
        actions={
          <>
            <Button size="sm" onClick={() => { const v = !sound; setSound(v); localStorageSet('kds-sound', v ? '1' : '0'); if (v) beep(); }}>
              {sound ? '🔔 Som ligado' : '🔕 Som desligado'}
            </Button>
            <Button size="sm" onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}>
              Tela cheia
            </Button>
          </>
        }
        flush
      >
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div style={{ padding: 12 }}>
            <ErrorBox error={q.error} retry={() => q.refetch()} />
          </div>
        ) : (
          <div className="kds-cols">
            {cols.map((c) => {
              const list = tickets.filter((t) => (t.orderStatus === 'cancelled' ? c.status === 'received' : t.status === c.status));
              return (
                <section key={c.status} className="kds-col" aria-label={c.title}>
                  <h2>
                    {c.title} <span className="badge">{list.length}</span>
                  </h2>
                  {list.length === 0 && <Empty title="Nada aqui" />}
                  {list.map((t) => (
                    <TicketCard key={t.id} t={t} lateMinutes={q.data!.lateMinutes} />
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </Layout>
    </div>
  );
}

function TicketCard({ t, lateMinutes }: { t: KTicket; lateMinutes: number }) {
  const qc = useQueryClient();
  const { busy, go } = useAction();
  const cancelled = t.orderStatus === 'cancelled';
  const waiting = minutesSince(t.createdAt, t.readyAt ? new Date(t.readyAt).getTime() : Date.now());
  const late = !cancelled && t.status !== 'ready' && waiting >= lateMinutes;
  const changed = !!t.changedAt && !cancelled;
  const move = (status: KitchenStatus) =>
    go(async () => {
      await post(`/api/kitchen/tickets/${t.id}/status`, { status });
      await qc.invalidateQueries({ queryKey: ['kitchen'] });
    });
  const label = t.orderType === 'table' ? t.place : ORDER_TYPE_LABEL[t.orderType];
  return (
    <article className={'ticket' + (late ? ' late' : '') + (changed ? ' changed' : '') + (cancelled ? ' cancelled' : '')} aria-label={`Pedido ${t.orderNumber}`}>
      <div className="ticket-head">
        <span className="tn">#{t.orderNumber}</span>
        <span>
          {label}
          {t.round > 1 && <> · <b>rodada {t.round}</b></>}
        </span>
        <span className="timer" title={`Recebido às ${formatTime(t.createdAt)}`}>
          {waiting} min
        </span>
      </div>
      {t.round > 1 && !cancelled && <div className="ticket-extra">ACRÉSCIMO — só os itens abaixo (rodada {t.round})</div>}
      {cancelled && <div className="ticket-change" style={{ background: '#ff5b3d', color: '#fff' }}>PEDIDO CANCELADO — NÃO PREPARAR</div>}
      {changed && <div className="ticket-change">ALTERADO às {formatTime(t.changedAt)}: {t.changeNote}</div>}
      <div className="ticket-body">
        <div className="ticket-who">
          {formatTime(t.createdAt)} · {t.createdByName ? `por ${t.createdByName}` : 'cardápio digital'}
          {t.customerName ? ` · ${t.customerName}` : ''}
        </div>
        {t.orderNotes && <div className="ticket-note">Obs.: {t.orderNotes}</div>}
        {t.items.map((i) => {
          const removes = i.options.filter((o) => /^sem /i.test(o.name));
          const adds = i.options.filter((o) => !/^sem /i.test(o.name));
          return (
            <div key={i.id} className={'ticket-item' + (i.status === 'cancelled' ? ' void' : '')}>
              <span className="q">{i.quantity}x</span>
              {i.productName}
              {i.variantName ? ` (${i.variantName})` : ''}
              {i.status === 'cancelled' && ' — CANCELADO'}
              {Array.isArray(i.comboComponents) && i.comboComponents.length > 0 && (
                <div className="mods">{i.comboComponents.map((c: any) => `${c.quantity}x ${c.label}`).join(' + ')}</div>
              )}
              {(adds.length > 0 || removes.length > 0) && (
                <div className="mods">
                  {adds.map((o) => `+ ${o.quantity > 1 ? o.quantity + 'x ' : ''}${o.name}`).join('  ')}
                  {removes.length > 0 && <span className="rm"> {removes.map((o) => o.name.toUpperCase()).join('  ')}</span>}
                </div>
              )}
              {i.notes && <div className="obs">“{i.notes}”</div>}
            </div>
          );
        })}
      </div>
      {!cancelled && (
        <div className="ticket-actions">
          {t.status === 'received' && (
            <>
              <Button variant="primary" busy={busy} onClick={() => move('preparing')}>
                Iniciar preparo
              </Button>
              <Button variant="success" busy={busy} onClick={() => move('ready')}>
                Pronto
              </Button>
            </>
          )}
          {t.status === 'preparing' && (
            <>
              <Button busy={busy} onClick={() => move('received')} aria-label="Voltar para recebido">
                ↩
              </Button>
              <Button variant="success" busy={busy} onClick={() => move('ready')}>
                Pronto
              </Button>
            </>
          )}
          {t.status === 'ready' && (
            <Button busy={busy} onClick={() => move('preparing')}>
              Desfazer “pronto”
            </Button>
          )}
        </div>
      )}
      <span className="sr-only">{KITCHEN_STATUS_LABEL[t.status]}</span>
    </article>
  );
}

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignora */
  }
}
