import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Clock,
  Flame,
  Inbox,
  Maximize,
  MessageSquareText,
  Pencil,
  PlusCircle,
  Sparkles,
  Undo2,
  UserRound,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_STATUS_LABEL, ORDER_TYPE_LABEL, type KitchenStatus } from '@guto/core';
import { Layout } from '../components/Layout';
import { Button, Empty, ErrorBox, Loading, useAction, useUi } from '../components/ui';
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
  const [big, setBig] = useState(() => localStorageGet('kds-big') === '1');
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
  const cols: { status: KitchenStatus; title: string; icon: LucideIcon }[] = [
    { status: 'received', title: 'Recebidos', icon: Inbox },
    { status: 'preparing', title: 'Em preparo', icon: Flame },
    { status: 'ready', title: 'Prontos (últimos 20 min)', icon: CheckCircle2 },
  ];
  const pending = tickets.filter((t) => t.orderStatus !== 'cancelled' && t.status !== 'ready');
  const lateMinutes = q.data?.lateMinutes ?? 15;
  const oldest = pending.reduce((m, t) => Math.max(m, minutesSince(t.createdAt)), 0);
  // gargalo: quantidades por produto ainda não prontas (o que mais tem para fazer agora)
  const load = new Map<string, number>();
  for (const t of pending) for (const i of t.items) if (i.status !== 'cancelled') load.set(i.productName + (i.variantName ? ` (${i.variantName})` : ''), (load.get(i.productName + (i.variantName ? ` (${i.variantName})` : '')) ?? 0) + i.quantity);
  const top = [...load.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const late = pending.filter((t) => minutesSince(t.createdAt) >= lateMinutes).length;

  return (
    <div className={'kds' + (big ? ' big' : '')}>
      <Layout
        title="Cozinha"
        actions={
          <span className="kds-tools">
            <Button
              size="sm"
              icon={big ? ZoomOut : ZoomIn}
              aria-pressed={big}
              onClick={() => {
                setBig(!big);
                localStorageSet('kds-big', big ? '0' : '1');
              }}
            >
              {big ? 'Letra normal' : 'Letra grande'}
            </Button>
            <Button
              size="sm"
              icon={sound ? Bell : BellOff}
              aria-pressed={sound}
              onClick={() => {
                const v = !sound;
                setSound(v);
                localStorageSet('kds-sound', v ? '1' : '0');
                if (v) beep();
              }}
            >
              {sound ? 'Som ligado' : 'Som desligado'}
            </Button>
            <Button size="sm" icon={Maximize} aria-label="Tela cheia" title="Tela cheia" onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)} />
          </span>
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
          <>
            <div className="kds-summary" aria-label="Resumo da fila">
              <span className="badge outline">
                <Inbox className="icon" aria-hidden /> {pending.length} na fila
              </span>
              {pending.length > 0 && (
                <span className={'badge ' + (oldest >= lateMinutes ? 'red' : 'outline')}>
                  <Clock className="icon" aria-hidden /> mais antigo: {oldest} min
                </span>
              )}
              {late > 0 && (
                <span className="badge red">
                  <AlertTriangle className="icon" aria-hidden /> {late} atrasado(s) (≥ {lateMinutes} min)
                </span>
              )}
              {top.length > 0 && (
                <span className="load">
                  <b>A fazer:</b>
                  {top.map(([name, n]) => (
                    <span key={name} className="badge">
                      {n}× {name}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div className="kds-cols">
              {cols.map((c) => {
                const list = tickets.filter((t) => (t.orderStatus === 'cancelled' ? c.status === 'received' : t.status === c.status));
                return (
                  <section key={c.status} className="kds-col" aria-label={c.title}>
                    <h2>
                      <c.icon className="icon" aria-hidden /> {c.title} <span className="badge">{list.length}</span>
                    </h2>
                    {list.length === 0 && <Empty compact title={c.status === 'ready' ? 'Nenhum pronto recente' : 'Nada aqui'} />}
                    {list.map((t) => (
                      <TicketCard key={t.id} t={t} lateMinutes={lateMinutes} />
                    ))}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </Layout>
    </div>
  );
}

/** Tempo mínimo sem mudar de lugar para aceitar um toque (evita acertar o pedido errado quando a lista se move). */
const MOVE_GUARD_MS = 600;

function TicketCard({ t, lateMinutes }: { t: KTicket; lateMinutes: number }) {
  const qc = useQueryClient();
  const ui = useUi();
  const { busy, go } = useAction();
  const ref = useRef<HTMLElement>(null);
  const lastTop = useRef<number | null>(null);
  const movedAt = useRef(0);
  useLayoutEffect(() => {
    const top = ref.current?.offsetTop ?? 0;
    if (lastTop.current != null && Math.abs(top - lastTop.current) > 4) movedAt.current = Date.now();
    lastTop.current = top;
  });
  const cancelled = t.orderStatus === 'cancelled';
  const waiting = minutesSince(t.createdAt, t.readyAt ? new Date(t.readyAt).getTime() : Date.now());
  const late = !cancelled && t.status !== 'ready' && waiting >= lateMinutes;
  const changed = !!t.changedAt && !cancelled;
  const fresh = !cancelled && t.status === 'received' && minutesSince(t.createdAt) < 2;
  const move = (status: KitchenStatus) => {
    if (Date.now() - movedAt.current < MOVE_GUARD_MS) {
      ui.toast('Os pedidos mudaram de lugar. Confira o cartão e toque de novo.', 'info');
      return;
    }
    void go(async () => {
      await post(`/api/kitchen/tickets/${t.id}/status`, { status });
      await qc.invalidateQueries({ queryKey: ['kitchen'] });
    });
  };
  const label = t.orderType === 'table' ? t.place : ORDER_TYPE_LABEL[t.orderType];
  return (
    <article
      ref={ref}
      className={`ticket st-${t.status}` + (late ? ' late' : '') + (changed ? ' changed' : '') + (cancelled ? ' cancelled' : '')}
      aria-label={`Pedido ${t.orderNumber}`}
    >
      <div className="ticket-head">
        <span style={{ minWidth: 0 }}>
          <span className="tplace">{label}</span>
          <span className="tn">
            Pedido #{t.orderNumber}
            {t.round > 1 && ` · rodada ${t.round}`}
          </span>
        </span>
        <span className="timer" title={`Recebido às ${formatTime(t.createdAt)}`}>
          {late ? <AlertTriangle className="icon" aria-hidden /> : <Clock className="icon" aria-hidden />}
          {waiting} min
        </span>
      </div>
      {cancelled && (
        <div className="ticket-flag cancel">
          <Ban className="icon" aria-hidden /> PEDIDO CANCELADO — NÃO PREPARAR
        </div>
      )}
      {!cancelled && t.round > 1 && (
        <div className="ticket-flag extra">
          <PlusCircle className="icon" aria-hidden /> ACRÉSCIMO — só os itens abaixo (rodada {t.round})
        </div>
      )}
      {fresh && t.round === 1 && (
        <div className="ticket-flag new">
          <Sparkles className="icon" aria-hidden /> NOVO
        </div>
      )}
      {changed && (
        <div className="ticket-flag changed">
          <Pencil className="icon" aria-hidden /> ALTERADO às {formatTime(t.changedAt)}: {t.changeNote}
        </div>
      )}
      {late && (
        <div className="ticket-flag late">
          <AlertTriangle className="icon" aria-hidden /> ATRASADO — esperando há {waiting} min
        </div>
      )}
      <div className="ticket-body">
        <div className="ticket-who">
          <Clock className="icon" aria-hidden /> {formatTime(t.createdAt)}
          <UserRound className="icon" aria-hidden /> {t.createdByName ? `por ${t.createdByName}` : 'cardápio digital'}
          {t.customerName ? ` · ${t.customerName}` : ''}
        </div>
        {t.orderNotes && <div className="ticket-note">Obs. do pedido: {t.orderNotes}</div>}
        {t.items.map((i) => {
          const removes = i.options.filter((o) => /^sem /i.test(o.name));
          const adds = i.options.filter((o) => !/^sem /i.test(o.name));
          return (
            <div key={i.id} className={'ticket-item' + (i.status === 'cancelled' ? ' void' : '')}>
              <span className="q">{i.quantity}</span>
              {i.productName}
              {i.variantName ? ` (${i.variantName})` : ''}
              {i.status === 'cancelled' && ' — CANCELADO'}
              {Array.isArray(i.comboComponents) && i.comboComponents.length > 0 && (
                <div className="mods">{i.comboComponents.map((c: any) => `${c.quantity}x ${c.label}`).join(' + ')}</div>
              )}
              {(adds.length > 0 || removes.length > 0) && (
                <div className="mods">
                  {adds.map((o) => (
                    <span key={o.name} className="add">
                      + {o.quantity > 1 ? o.quantity + 'x ' : ''}
                      {o.name}
                    </span>
                  ))}
                  {removes.map((o) => (
                    <span key={o.name} className="rm">
                      {o.name.toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
              {i.notes && (
                <div className="obs">
                  <MessageSquareText className="icon" aria-hidden />“{i.notes}”
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!cancelled && (
        <div className="ticket-actions">
          {t.status === 'received' && (
            <>
              <Button variant="primary" className="act-main" busy={busy} icon={Flame} onClick={() => move('preparing')}>
                Iniciar preparo
              </Button>
              <Button variant="ghost" className="act-side" busy={busy} onClick={() => move('ready')} title="Marcar pronto sem passar por “em preparo”">
                Pronto
              </Button>
            </>
          )}
          {t.status === 'preparing' && (
            <>
              <Button className="act-side" busy={busy} icon={Undo2} onClick={() => move('received')} aria-label="Voltar para recebido" title="Voltar para recebido" />
              <Button variant="success" className="act-main" busy={busy} icon={Check} onClick={() => move('ready')}>
                Pronto
              </Button>
            </>
          )}
          {t.status === 'ready' && (
            <Button variant="ghost" size="sm" className="act-main" busy={busy} icon={Undo2} onClick={() => move('preparing')}>
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
