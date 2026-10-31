import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  CloudOff,
  Flame,
  Hash,
  LogOut,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Send,
  UserRound,
  Utensils,
  WifiOff,
  X,
} from 'lucide-react';
import { formatBRL, placeLabel, searchFilter, unitTotal } from '@guto/core';
import { ConnectionPill } from '../../components/Layout';
import { Logo } from '../../components/Logo';
import { lineToItemInput, lineTotal, ProductDialog } from '../../components/ProductDialog';
import { Alert, Button, Empty, ErrorBox, Loading, Modal, Segmented, Stepper, useAction, useUi } from '../../components/ui';
import { ApiError, get, newIdemKey, post, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { elapsedLabel, formatTime, shortName } from '../../lib/format';
import { useConnection } from '../../lib/live';
import { useDay, useMenu, useOrder, useSettings } from '../../lib/queries';
import type { CartLine, MenuProduct, Order, OrderItem, OrderRow, Ticket } from '../../lib/types';
import { moveDraft, useDraft } from './draft';
import { lineFromItem } from '../../lib/repeat';

/** App do atendente (PWA para celular/tablet). Mesmo servidor e banco do caixa e da cozinha. */
export default function Waiter() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="pedido/:id" element={<OrderScreen />} />
      <Route path="nova/:kind/:label" element={<OrderScreen />} />
    </Routes>
  );
}

function Shell({ title, subtitle, back, children, foot }: { title: ReactNode; subtitle?: ReactNode; back?: string; children: ReactNode; foot?: ReactNode }) {
  const { me, logout } = useAuth();
  const conn = useConnection();
  return (
    <div className="waiter">
      <header className="waiter-head">
        {back ? (
          <Link to={back} className="waiter-back" aria-label="Voltar">
            <ArrowLeft size={24} aria-hidden />
          </Link>
        ) : (
          <Logo size={30} />
        )}
        <div className="waiter-title">
          <b>{title}</b>
          <small>{subtitle ?? me?.name}</small>
        </div>
        <ConnectionPill />
        {!back && (
          <button type="button" className="waiter-logout" onClick={() => void logout()} aria-label="Sair" title="Sair">
            <LogOut size={20} aria-hidden />
          </button>
        )}
      </header>
      {conn === 'offline' && (
        <div className="offline-banner" role="alert">
          <WifiOff size={18} aria-hidden /> Sem conexão. Nada é enviado à cozinha até a conexão voltar. Seu rascunho fica guardado neste aparelho.
        </div>
      )}
      <main className="waiter-body">{children}</main>
      {foot && <footer className="waiter-foot">{foot}</footer>}
    </div>
  );
}

// ---------------------------------------------------------------- mesas e comandas

const tileState = (o: OrderRow) => (o.billRequestedAt ? 'bill' : o.rounds?.ready ? 'ready' : 'busy');
const stateText = (o: OrderRow) => {
  const r = o.rounds;
  if (o.billRequestedAt) return 'Conta pedida';
  if (!r) return 'Aberta';
  if (r.ready > 0) return 'Pronto p/ servir';
  if (r.preparing > 0) return 'Em preparo';
  if (r.received > 0) return 'Enviado';
  if (r.served > 0) return 'Entregue';
  return 'Aberta';
};

function Home() {
  const { me } = useAuth();
  const nav = useNavigate();
  const day = useDay();
  const settings = useSettings();
  const [tab, setTab] = useState<'table' | 'tab' | 'mine'>('table');
  const [newTab, setNewTab] = useState('');
  const list = useQuery({
    queryKey: ['tables', 'waiter', day.data?.day?.id],
    queryFn: () => get<OrderRow[]>('/api/orders' + qs({ type: 'table', status: 'open,pending', dayId: day.data?.day?.id })),
    enabled: !!day.data?.day,
    refetchInterval: 30000,
  });
  const open = list.data ?? [];
  const mine = open.filter((o) => o.createdByName === me?.name);
  const readyMine = mine.filter((o) => (o.rounds?.ready ?? 0) > 0);
  // aviso discreto: vibra quando surge item pronto numa mesa minha
  const lastReady = useRef<number | null>(null);
  useEffect(() => {
    const n = readyMine.reduce((a, o) => a + (o.rounds?.ready ?? 0), 0);
    if (lastReady.current != null && n > lastReady.current) navigator.vibrate?.([80, 60, 80]);
    lastReady.current = n;
  }, [readyMine]);

  if (day.isLoading || settings.isLoading) return <Shell title="Atendimento"><Loading /></Shell>;
  if (!day.data?.day)
    return (
      <Shell title="Atendimento">
        <Empty icon={Clock} title="O dia operacional ainda não foi aberto">
          <span>Peça ao caixa para abrir o dia.</span>
        </Empty>
      </Shell>
    );
  const tables: string[] = settings.data?.tables ?? [];
  const tabs = open.filter((o) => o.tabKind === 'tab');
  const busyTables = open.filter((o) => o.tabKind === 'table').length;

  const tile = (o: OrderRow | undefined, kind: 'table' | 'tab', label: string, onClick: () => void) => {
    const name = `${kind === 'tab' ? 'Comanda' : 'Mesa'} ${label}`;
    if (!o)
      return (
        <button key={name} type="button" className="wtile free" onClick={onClick} aria-label={`${name}, livre`}>
          <span className="wkind">{kind === 'tab' ? 'Comanda' : 'Mesa'}</span>
          <span className="wnum">{label}</span>
          <span className="wmeta muted">Livre</span>
        </button>
      );
    const st = tileState(o);
    const Ico = st === 'bill' ? ReceiptText : st === 'ready' ? CheckCircle2 : Utensils;
    return (
      <button
        key={name + o.id}
        type="button"
        className={`wtile ${st}${o.createdByName === me?.name ? ' mine' : ''}`}
        onClick={onClick}
        aria-label={`${name}, ${stateText(o)}, ${formatBRL(o.totalCents)}, ${o.createdByName ?? ''}`}
      >
        <span className="wstate">
          <Ico className="icon" aria-hidden />
        </span>
        <span className="wkind">{kind === 'tab' ? 'Comanda' : 'Mesa'}</span>
        <span className="wnum">{label}</span>
        <span className="wamount">{formatBRL(o.totalCents)}</span>
        <span className="wmeta">
          {stateText(o)} · {elapsedLabel(o.createdAt)}
        </span>
        <span className="wmeta muted">{shortName(o.createdByName)}</span>
      </button>
    );
  };
  const goOrder = (o: OrderRow) => nav(`/atendente/pedido/${o.id}`);

  return (
    <Shell title="Atendimento">
      <div className="waiter-tabs">
        <Segmented
          label="Mostrar"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'table', label: `Mesas ${busyTables}/${tables.length}` },
            { id: 'tab', label: `Comandas ${tabs.length}` },
            { id: 'mine', label: `Minhas ${mine.length}` },
          ]}
        />
      </div>
      {list.error && <ErrorBox error={list.error} retry={() => list.refetch()} />}
      {readyMine.length > 0 && (
        <Alert kind="ok" icon={ChefHat} role="status">
          <b>Pronto para servir:</b>{' '}
          <span className="hstack" style={{ display: 'inline-flex', marginTop: 4 }}>
            {readyMine.map((o) => (
              <Button key={o.id} size="sm" onClick={() => goOrder(o)}>
                {placeLabel(o)}
              </Button>
            ))}
          </span>
        </Alert>
      )}
      {tab === 'table' && (
        <div className="waiter-grid">
          {tables.map((t) => {
            const o = open.find((x) => x.tabKind === 'table' && x.tableLabel === t);
            return tile(o, 'table', t, () => (o ? goOrder(o) : nav(`/atendente/nova/table/${encodeURIComponent(t)}`)));
          })}
        </div>
      )}
      {tab === 'tab' && (
        <>
          <form
            className="hstack"
            style={{ marginBottom: 12, flexWrap: 'nowrap', alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              const label = newTab.trim();
              if (!label) return;
              const o = tabs.find((x) => x.tableLabel === label);
              nav(o ? `/atendente/pedido/${o.id}` : `/atendente/nova/tab/${encodeURIComponent(label)}`);
            }}
          >
            <label className="field" style={{ flex: 1, margin: 0 }}>
              <span>Número da comanda</span>
              <input inputMode="numeric" enterKeyHint="go" value={newTab} onChange={(e) => setNewTab(e.target.value.slice(0, 20))} placeholder="ex.: 15" />
            </label>
            <Button type="submit" variant="primary" icon={Hash} disabled={!newTab.trim()}>
              Abrir
            </Button>
          </form>
          {tabs.length === 0 ? (
            <Empty compact icon={Hash} title="Nenhuma comanda aberta">
              <span>Digite o número da comanda e toque em Abrir.</span>
            </Empty>
          ) : (
            <div className="waiter-grid">{tabs.map((o) => tile(o, 'tab', o.tableLabel ?? '?', () => goOrder(o)))}</div>
          )}
        </>
      )}
      {tab === 'mine' &&
        (mine.length === 0 ? (
          <Empty compact icon={UserRound} title="Você ainda não abriu mesas hoje" />
        ) : (
          <div className="waiter-grid">{mine.map((o) => tile(o, o.tabKind, o.tableLabel ?? '?', () => goOrder(o)))}</div>
        ))}
    </Shell>
  );
}

// ---------------------------------------------------------------- pedido da mesa/comanda

const ROUND_LABEL = (t: Ticket) =>
  t.servedAt ? (
    <span className="badge">
      <Check className="icon" aria-hidden />
      Entregue {formatTime(t.servedAt)}
    </span>
  ) : t.status === 'ready' ? (
    <span className="badge green pulse">
      <CheckCircle2 className="icon" aria-hidden />
      Pronto
    </span>
  ) : t.status === 'preparing' ? (
    <span className="badge yellow">
      <Flame className="icon" aria-hidden />
      Em preparo
    </span>
  ) : (
    <span className="badge blue">
      <Send className="icon" aria-hidden />
      Enviado · aguardando cozinha
    </span>
  );

function OrderScreen() {
  const params = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const ui = useUi();
  const orderId = params.id ?? null;
  const kind = (params.kind === 'tab' ? 'tab' : 'table') as 'table' | 'tab';
  const label = params.label ? decodeURIComponent(params.label) : null;
  const target = orderId ? `order:${orderId}` : `new:${kind}:${label}`;
  const order = useOrder(orderId);
  const menu = useMenu();
  const { draft, setDraft, editLines, clear } = useDraft(target);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<{ product: MenuProduct; line?: CartLine } | null>(null);
  const [review, setReview] = useState(false);
  const location = useLocation() as { state?: { confirmed?: { at: string; round: number | null; count: number } } };
  const [confirmed, setConfirmed] = useState<{ at: string; round: number | null; count: number } | null>(location.state?.confirmed ?? null);
  const action = useAction();

  const products = useMemo(() => (menu.data ?? []).flatMap((c) => c.products), [menu.data]);
  const o = order.data;
  const title = o ? o.place : placeLabel({ type: 'table', tabKind: kind, tableLabel: label });
  const subtitle = o ? `Pedido #${o.number} · ${shortName(o.createdByName)} · ${elapsedLabel(o.createdAt)}` : 'Novo atendimento';
  const draftTotal = draft.lines.reduce((a, l) => a + lineTotal(l), 0);
  const draftCount = draft.lines.reduce((a, l) => a + l.quantity, 0);
  const locked = draft.state !== 'editing';

  const addLine = (line: CartLine) =>
    editLines((ls) => {
      const same = ls.find((x) => x.variantId === line.variantId && !x.notes && !line.notes && x.options.length === 0 && line.options.length === 0);
      return same ? ls.map((x) => (x === same ? { ...x, quantity: Math.min(99, x.quantity + line.quantity) } : x)) : [...ls, line];
    });

  async function send() {
    if (draft.state === 'sending' || !draft.lines.length) return;
    setDraft((d) => ({ ...d, state: 'sending', error: null }));
    const items = draft.lines.map(lineToItemInput);
    try {
      let fresh: Order & { sentTicketId?: string | null };
      if (orderId) {
        fresh = await post(`/api/orders/${orderId}/items`, { items }, { idempotencyKey: draft.key });
      } else {
        fresh = await post('/api/orders', { type: 'table', tabKind: kind, tableLabel: label, items }, { idempotencyKey: draft.key });
      }
      const round = fresh.sentTicketId ? (fresh.tickets.find((t) => t.id === fresh.sentTicketId)?.round ?? null) : (fresh.tickets.at(-1)?.round ?? null);
      clear();
      setReview(false);
      const conf = { at: new Date().toISOString(), round, count: draftCount };
      setConfirmed(conf);
      navigator.vibrate?.(40);
      qc.setQueryData(['order', fresh.id], fresh);
      void qc.invalidateQueries({ queryKey: ['tables'] });
      if (!orderId) nav(`/atendente/pedido/${fresh.id}`, { replace: true, state: { confirmed: conf } });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'network', (e as Error).message);
      if (err.code === 'network' || err.status >= 500 || err.code === 'idempotency_in_progress' || err.code === 'retry') {
        setDraft((d) => ({
          ...d,
          state: 'unconfirmed',
          error: 'Falhou: não recebemos a confirmação do servidor. O pedido NÃO está confirmado. Toque em “Reenviar” quando a conexão voltar — não haverá duplicidade.',
        }));
      } else if (err.code === 'table_busy' && err.details?.id) {
        setDraft((d) => ({ ...d, state: 'editing', error: null }));
        const ok = await ui.confirm({ title: 'Mesa já aberta', message: `${err.message}`, confirmLabel: 'Usar a comanda aberta' });
        if (ok) {
          moveDraft(target, `order:${err.details.id}`);
          nav(`/atendente/pedido/${err.details.id}`, { replace: true });
        }
      } else {
        // recusado pelo servidor (ex.: item indisponível): nada foi gravado; pode corrigir e enviar de novo
        setDraft((d) => ({ ...d, state: 'editing', key: newIdemKey(), error: err.message }));
      }
    }
  }

  const requestBill = async () => {
    if (!o) return;
    const ok = await ui.confirm({ title: `Pedir a conta da ${o.place}?`, message: `Total atual ${formatBRL(o.totalCents)}. O caixa será avisado.`, confirmLabel: 'Pedir a conta' });
    if (!ok) return;
    await action.go(async () => qc.setQueryData(['order', o.id], await post(`/api/orders/${o.id}/request-bill`, {})), { success: 'Conta solicitada ao caixa' });
  };

  const served = (t: Ticket) =>
    action.go(async () => {
      await post(`/api/kitchen/tickets/${t.id}/served`, {});
      await qc.invalidateQueries({ queryKey: ['order', o!.id] });
    });

  const cancelSent = async (itemId: string, name: string) => {
    if (!o) return;
    const reason = await ui.confirm({ title: `Cancelar ${name}?`, message: 'A cozinha verá o cancelamento em destaque. Exige autorização do gerente.', reasonLabel: 'Motivo', danger: true, confirmLabel: 'Cancelar item' });
    if (typeof reason !== 'string') return;
    await action.go(async (sup) => qc.setQueryData(['order', o.id], await post(`/api/orders/${o.id}/items/${itemId}/cancel`, { version: o.version, reason, supervisor: sup })), { success: 'Item cancelado' });
  };

  const repeat = (i: OrderItem) => {
    const line = lineFromItem(i, products);
    if (!line) return ui.toast(`${i.productName} não está disponível agora no cardápio.`, 'error');
    addLine(line);
    ui.toast(`+1 ${i.productName} no rascunho`, 'ok');
  };

  if (orderId && order.isLoading) return <Shell title="Carregando…" back="/atendente"><Loading /></Shell>;
  if (orderId && order.error) return <Shell title="Pedido" back="/atendente"><ErrorBox error={order.error} retry={() => order.refetch()} /></Shell>;
  const closed = o && o.status !== 'open' && o.status !== 'pending';
  const noKitchen = o?.items.filter((i) => i.sentAt && !i.ticketId) ?? [];
  const canRepeat = !closed && !locked;

  const RepeatBtn = ({ i }: { i: OrderItem }) =>
    canRepeat && i.status === 'active' ? (
      <Button size="sm" variant="ghost" icon={RotateCcw} aria-label={`Repetir ${i.productName}`} title="Adicionar mais um ao rascunho" onClick={() => repeat(i)} />
    ) : null;

  return (
    <Shell
      title={title}
      subtitle={subtitle}
      back="/atendente"
      foot={
        !closed && (
          <>
            {o && o.status === 'open' && (
              <Button icon={ReceiptText} onClick={requestBill} disabled={!!o.billRequestedAt || action.busy}>
                {o.billRequestedAt ? 'Conta pedida' : 'Pedir a conta'}
              </Button>
            )}
            <Button
              variant={draft.state === 'unconfirmed' ? 'danger' : 'primary'}
              className={draft.state === 'unconfirmed' ? 'solid' : undefined}
              size="lg"
              icon={draft.state === 'unconfirmed' ? CloudOff : Send}
              style={{ flex: 1 }}
              disabled={!draft.lines.length || draft.state === 'sending'}
              onClick={() => setReview(true)}
            >
              {draft.state === 'unconfirmed' ? 'Reenviar pedido' : `Conferir e enviar${draftCount ? ` (${draftCount})` : ''}`}
            </Button>
          </>
        )
      }
    >
      {o && (
        <div className="hstack" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
          <small className="muted">Aberta às {formatTime(o.createdAt)}</small>
          <span>
            <small className="muted">Total </small>
            <b className="money" style={{ fontSize: '1.15rem' }}>{formatBRL(o.totalCents)}</b>
          </span>
        </div>
      )}
      {closed && <Alert kind="info">Este pedido está {o!.status === 'closed' ? 'finalizado' : 'cancelado'}.</Alert>}
      {o?.billRequestedAt && (
        <Alert kind="bill" icon={ReceiptText}>
          Conta pedida ao caixa às {formatTime(o.billRequestedAt)}
          {o.billRequestedByName ? ` por ${o.billRequestedByName}` : ''}.
        </Alert>
      )}

      {draft.state === 'sending' && (
        <div className="send-banner sending" role="status">
          <span className="spin" aria-hidden /> <div>Enviando para o servidor… não feche o app.</div>
        </div>
      )}
      {draft.state === 'unconfirmed' && (
        <div className="send-banner fail" role="alert">
          <AlertTriangle className="icon" aria-hidden />
          <div>
            <b>Envio não confirmado.</b> {draft.error}
            <div style={{ marginTop: 10 }}>
              <Button variant="danger" className="solid" icon={RotateCcw} onClick={send}>
                Reenviar agora
              </Button>
            </div>
          </div>
        </div>
      )}
      {draft.state === 'editing' && draft.error && (
        <div className="send-banner fail" role="alert">
          <AlertTriangle className="icon" aria-hidden />
          <div>
            <b>Não enviado:</b> {draft.error}
          </div>
        </div>
      )}
      {confirmed && draft.state === 'editing' && !draft.error && (
        <div className="send-banner ok" role="status">
          <CheckCircle2 className="icon" aria-hidden />
          <div>
            Recebido pelo servidor às {formatTime(confirmed.at)} — {confirmed.count} item(ns){confirmed.round ? ` na rodada ${confirmed.round}` : ''}. Já aparece no caixa
            {confirmed.round ? ' e na cozinha' : ''}.
          </div>
        </div>
      )}

      <section aria-label="Novo pedido" className={'card draft-card' + (draft.lines.length ? ' has-items' : '')}>
        <div className="hstack" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>Novo pedido</h2>
          {draft.lines.length > 0 && <span className="badge orange">rascunho · ainda não enviado</span>}
          <span className="spacer" />
          {draft.lines.length > 0 && <b className="money">{formatBRL(draftTotal)}</b>}
        </div>
        {draft.lines.length === 0 && <p className="muted" style={{ margin: '4px 0 0' }}>Os itens ficam guardados neste aparelho até você enviar.</p>}
        {locked && draft.state === 'unconfirmed' && <p className="muted">Rascunho travado até a confirmação do envio, para evitar pedido duplicado.</p>}
        {draft.lines.map((l) => (
          <div key={l.key} className="cart-item">
            <Stepper label={l.productName} value={l.quantity} min={0} max={99} onChange={(v) => editLines((ls) => (v === 0 ? ls.filter((x) => x.key !== l.key) : ls.map((x) => (x.key === l.key ? { ...x, quantity: v } : x))))} />
            <button
              type="button"
              className="linkish"
              disabled={locked}
              aria-label={`Editar ${l.productName}`}
              onClick={() => {
                const p = products.find((x) => x.variants.some((v) => v.id === l.variantId));
                if (p) setEditing({ product: p, line: l });
              }}
            >
              <span className="item-name">
                {l.productName}
                {l.variantName ? ` (${l.variantName})` : ''}
              </span>
              {l.options.length > 0 && <div className="opts">{l.options.map((x) => (x.quantity > 1 ? `${x.quantity}x ` : '') + x.name).join(', ')}</div>}
              {l.notes && <div className="note">“{l.notes}”</div>}
            </button>
            <span className="money" style={{ paddingTop: 10 }}>{formatBRL(lineTotal(l))}</span>
          </div>
        ))}
        {!closed && (
          <Button block icon={Plus} style={{ marginTop: 12 }} variant={draft.lines.length ? undefined : 'primary'} disabled={locked} onClick={() => setPicking(true)}>
            Adicionar produtos
          </Button>
        )}
      </section>

      {o && o.tickets.length + noKitchen.length > 0 && (
        <section aria-label="Já enviado" style={{ marginTop: 16 }}>
          <h2 className="section-title">Já enviado</h2>
          <div className="stack" style={{ gap: 10 }}>
            {[...o.tickets].reverse().map((t) => {
              const its = o.items.filter((i) => i.ticketId === t.id);
              return (
                <div key={t.id} className={'card round-card' + (t.status === 'ready' && !t.servedAt ? ' ready' : '')}>
                  <div className="round-head">
                    <b>Rodada {t.round}</b>
                    <small className="muted">
                      {formatTime(t.createdAt)} · {shortName(t.createdByName)}
                    </small>
                    <span className="spacer" />
                    {ROUND_LABEL(t)}
                  </div>
                  {t.changeNote && <Alert kind="warn">Alteração: {t.changeNote}</Alert>}
                  {its.map((i) => (
                    <div key={i.id} className={'order-line' + (i.status === 'cancelled' ? ' cancelled' : '')}>
                      <div>
                        <span className="name">
                          <b>{i.quantity}x</b> {i.productName}
                          {i.variantName ? ` (${i.variantName})` : ''}
                        </span>
                        {i.options.length > 0 && (
                          <div>
                            <small className="muted">{i.options.map((x) => x.optionName).join(', ')}</small>
                          </div>
                        )}
                        {i.notes && <div className="note-text">“{i.notes}”</div>}
                        {i.status === 'cancelled' && <small className="muted">Cancelado: {i.cancelReason}</small>}
                      </div>
                      <span className="hstack" style={{ gap: 0, flexWrap: 'nowrap' }}>
                        <RepeatBtn i={i} />
                        {i.status === 'active' && !closed && !t.servedAt && (
                          <Button size="sm" variant="ghost" icon={X} aria-label={`Cancelar ${i.productName}`} title="Cancelar item (exige gerente)" onClick={() => cancelSent(i.id, i.productName)} />
                        )}
                      </span>
                    </div>
                  ))}
                  {t.status === 'ready' && !t.servedAt && (
                    <Button variant="success" block size="lg" icon={Check} busy={action.busy} onClick={() => served(t)} style={{ marginTop: 8 }}>
                      Entregue na mesa
                    </Button>
                  )}
                </div>
              );
            })}
            {noKitchen.length > 0 && (
              <div className="card round-card">
                <div className="round-head">
                  <b>Sem preparo</b>
                  <small className="muted">bebidas e outros · entregues direto</small>
                </div>
                {noKitchen.map((i) => (
                  <div key={i.id} className={'order-line' + (i.status === 'cancelled' ? ' cancelled' : '')}>
                    <span className="name">
                      <b>{i.quantity}x</b> {i.productName}
                      <div>
                        <small className="muted">{shortName(i.createdByName)}</small>
                      </div>
                    </span>
                    <RepeatBtn i={i} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {picking && (
        <ProductPicker
          products={products}
          draftLines={draft.lines}
          onClose={() => setPicking(false)}
          onQuickAdd={(line) => addLine(line)}
          onPick={(p) => {
            setPicking(false);
            setEditing({ product: p });
          }}
        />
      )}
      {editing && (
        <ProductDialog
          product={editing.product}
          initial={editing.line}
          onClose={() => setEditing(null)}
          onConfirm={(line) => {
            editLines((ls) => (editing.line ? ls.map((x) => (x.key === line.key ? line : x)) : [...ls, line]));
            setEditing(null);
          }}
        />
      )}
      {review && (
        <Modal
          title={`Conferir — ${title}`}
          onClose={() => draft.state !== 'sending' && setReview(false)}
          footer={
            <>
              <Button onClick={() => setReview(false)} disabled={draft.state === 'sending'}>
                Voltar
              </Button>
              <Button variant="success" size="lg" icon={Send} busy={draft.state === 'sending'} onClick={send}>
                {draft.state === 'sending' ? 'Enviando…' : draft.state === 'unconfirmed' ? 'Reenviar para a cozinha' : 'Enviar para a cozinha'}
              </Button>
            </>
          }
        >
          {draft.lines.map((l) => (
            <div key={l.key} className="order-line">
              <div>
                <b>{l.quantity}x</b> {l.productName}
                {l.variantName ? ` (${l.variantName})` : ''}
                {l.options.length > 0 && (
                  <div>
                    <small className="muted">{l.options.map((x) => x.name).join(', ')}</small>
                  </div>
                )}
                {l.notes && <div className="note-text">“{l.notes}”</div>}
              </div>
              <span className="money">{formatBRL(unitTotal({ unitPriceCents: l.unitPriceCents, options: l.options }) * l.quantity)}</span>
            </div>
          ))}
          <div className="totals" style={{ marginTop: 12 }}>
            <b>Total deste envio</b>
            <b className="money">{formatBRL(draftTotal)}</b>
          </div>
          <small className="muted">Só os itens acima serão enviados; o que já foi pedido não é reenviado. O valor oficial é conferido pelo servidor.</small>
          {draft.state === 'unconfirmed' && (
            <div style={{ marginTop: 8 }}>
              <Alert kind="error">{draft.error}</Alert>
            </div>
          )}
        </Modal>
      )}
    </Shell>
  );
}

/** Escolha de produtos: busca tolerante, categorias e lista de um toque. Produto sem adicionais entra direto. */
function ProductPicker({
  products,
  draftLines,
  onPick,
  onQuickAdd,
  onClose,
}: {
  products: MenuProduct[];
  draftLines: CartLine[];
  onPick: (p: MenuProduct) => void;
  onQuickAdd: (l: CartLine) => void;
  onClose: () => void;
}) {
  const menu = useMenu();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const list = q.trim() ? searchFilter(products, q, (p) => p) : products.filter((p) => cat === 'all' || p.categoryId === cat);
  const count = draftLines.reduce((a, l) => a + l.quantity, 0);
  const qtyOf = (p: MenuProduct) => draftLines.filter((l) => p.variants.some((v) => v.id === l.variantId)).reduce((a, l) => a + l.quantity, 0);
  const tap = (p: MenuProduct) => {
    const simple = p.groups.length === 0 && p.variants.length === 1;
    if (!simple) return onPick(p);
    const v = p.variants[0]!;
    onQuickAdd({ key: Math.random().toString(36).slice(2), variantId: v.id, productName: p.name, variantName: null, unitPriceCents: v.priceCents, options: [], quantity: 1, notes: '' });
  };
  return (
    <Modal
      wide
      title="Adicionar produtos"
      onClose={onClose}
      footer={
        <Button variant="primary" block size="lg" icon={Check} onClick={onClose}>
          {count ? `Concluir · ${count} no rascunho` : 'Fechar'}
        </Button>
      }
    >
      <div className="input-icon">
        <Search className="icon" aria-hidden />
        <input type="search" placeholder="Buscar produto ou código" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto" enterKeyHint="search" />
      </div>
      <div className="chips scroll" style={{ margin: '10px 0' }} role="group" aria-label="Categorias">
        <button type="button" className="chip" aria-pressed={cat === 'all' && !q} onClick={() => { setCat('all'); setQ(''); }}>
          Todos
        </button>
        {menu.data?.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id && !q} onClick={() => { setCat(c.id); setQ(''); }}>
            {c.name}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty compact title="Nenhum produto encontrado">
          <span>Confira a grafia ou busque pelo código.</span>
        </Empty>
      ) : (
        <div className="plist">
          {list.map((p) => {
            const off = !p.available || p.variants.every((v) => !v.available);
            const n = qtyOf(p);
            return (
              <button key={p.id} type="button" className={off ? 'off' : undefined} disabled={off} onClick={() => tap(p)} aria-label={`${p.name}${off ? ', indisponível' : ''}`}>
                <span className="pname">
                  {p.name}
                  <small className="muted">{off ? 'Indisponível' : p.groups.length ? 'toque para escolher adicionais' : 'toque para adicionar'}</small>
                </span>
                <span className="pprice">{formatBRL(Math.min(...p.variants.map((v) => v.priceCents)))}</span>
                {n > 0 ? (
                  <span className="pqty" aria-label={`${n} no rascunho`}>
                    {n}
                  </span>
                ) : (
                  <span className="padd" aria-hidden>
                    <Plus size={18} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
