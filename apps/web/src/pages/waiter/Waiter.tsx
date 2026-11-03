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
  LayoutGrid,
  Bike,
  LogOut,
  MessageCircle,
  ShoppingBag,
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
import { formatBRL, formatPhoneBR, normalizePhoneBR, ORDER_STAGE_LABEL, PAYMENT_METHOD_LABEL, placeLabel, searchFilter, unitTotal } from '@guto/core';
import { ConnectionPill } from '../../components/Layout';
import { Logo } from '../../components/Logo';
import { lineToItemInput, lineTotal, ProductDialog } from '../../components/ProductDialog';
import { Alert, Button, Empty, ErrorBox, Loading, Modal, Stepper, useAction, useUi } from '../../components/ui';
import { ApiError, get, newIdemKey, post, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { elapsedLabel, formatTime, shortName } from '../../lib/format';
import { useConnection } from '../../lib/live';
import { useDay, useMenu, useNeighborhoods, useOrder, useSettings } from '../../lib/queries';
import type { CartLine, MenuProduct, Order, OrderItem, OrderRow, Ticket } from '../../lib/types';
import { moveDraft, useDraft } from './draft';
import { lineFromItem } from '../../lib/repeat';
import { CustomerFields, customerPayload, emptyCustomer, type CustomerDraft } from '../../components/CustomerFields';
import { formatPlan, PaymentPlanEditor, type PlanPart } from '../../components/PaymentPlan';

/** App do atendente (PWA para celular/tablet). Mesmo servidor e banco do caixa e da cozinha. */
export default function Waiter() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="pedido/:id" element={<OrderScreen />} />
      <Route path="nova/:kind/:label" element={<OrderScreen />} />
      <Route path="whatsapp" element={<WhatsAppOrders channel="whatsapp" />} />
      <Route path="whatsapp/novo" element={<WhatsAppNew channel="whatsapp" />} />
      <Route path="balcao" element={<WhatsAppOrders channel="balcao" />} />
      <Route path="balcao/novo" element={<WhatsAppNew channel="balcao" />} />
    </Routes>
  );
}

function Shell({ title, subtitle, back, children, foot, nav, action }: { title: ReactNode; subtitle?: ReactNode; back?: string; children: ReactNode; foot?: ReactNode; nav?: ReactNode; action?: ReactNode }) {
  const { me, logout } = useAuth();
  const conn = useConnection();
  return (
    <div className="waiter">
      <header className="waiter-head">
        {back ? (
          <Link to={back} className="waiter-back" aria-label="Voltar">
            <ArrowLeft size={24} aria-hidden />
          </Link>
        ) : me && me.role !== 'waiter' ? (
          // gerente/caixa abrindo o app do atendente: volta ao sistema (no aplicativo da loja não há botão Voltar do navegador)
          <Link to="/" className="waiter-back" aria-label="Voltar ao sistema" title="Voltar ao sistema">
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
        {action}
        {/* sair em todas as telas (antes só na inicial e só com ícone): trocar de conta no celular */}
        <button type="button" className="waiter-logout" onClick={() => void logout()} aria-label="Sair" title="Sair (trocar de usuário)">
          <LogOut size={18} aria-hidden />
          <span>Sair</span>
        </button>
      </header>
      {conn === 'offline' && (
        <div className="offline-banner" role="alert">
          <WifiOff size={18} aria-hidden /> Sem conexão. Nada é enviado à cozinha até a conexão voltar. Seu rascunho fica guardado neste aparelho.
        </div>
      )}
      <main className="waiter-body">{children}</main>
      {foot && <footer className="waiter-foot">{foot}</footer>}
      {nav}
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
        <button key={name} type="button" className="tbl free" onClick={onClick} aria-label={`${name}, livre`}>
          <span className="tbl-band">
            <span>Livre</span>
            <Plus className="icon" aria-hidden />
          </span>
          <span className="tbl-body">
            <span className="tbl-num">{label}</span>
          </span>
        </button>
      );
    const st = tileState(o);
    const Ico = st === 'bill' ? ReceiptText : st === 'ready' ? CheckCircle2 : Utensils;
    return (
      <button
        key={name + o.id}
        type="button"
        className={`tbl ${st}`}
        onClick={onClick}
        aria-label={`${name}, ${stateText(o)}, ${formatBRL(o.totalCents)}, ${o.createdByName ?? ''}`}
      >
        <span className="tbl-band">
          <span>
            <Ico className="icon" aria-hidden /> {st === 'busy' ? stateText(o) : st === 'ready' ? 'Servir' : 'Conta'}
          </span>
        </span>
        <span className="tbl-body">
          <span className="tbl-num">
            {kind === 'tab' && <small>#</small>}
            {label}
          </span>
          <span className="tbl-amount" style={{ fontSize: '.875rem' }}>{formatBRL(o.totalCents)}</span>
          <span className="tbl-who">
            {o.createdByName === me?.name ? 'você' : shortName(o.createdByName)} · {elapsedLabel(o.createdAt)}
          </span>
        </span>
      </button>
    );
  };
  const goOrder = (o: OrderRow) => nav(`/atendente/pedido/${o.id}`);
  const bottomNav = (
    <nav className="waiter-nav" aria-label="Mostrar">
      {(
        [
          ['table', 'Mesas', LayoutGrid, `${busyTables}/${tables.length}`],
          ['tab', 'Comandas', Hash, String(tabs.length)],
          ['mine', 'Minhas', UserRound, String(mine.length)],
          ['balcao', 'Balcão', ShoppingBag, ''],
          ['whatsapp', 'Delivery', Bike, ''],
        ] as const
      ).map(([id, label, Ico, n]) => (
        <button key={id} type="button" aria-pressed={id !== 'whatsapp' && id !== 'balcao' && tab === id} onClick={() => (id === 'whatsapp' || id === 'balcao' ? nav(`/atendente/${id}`) : setTab(id))}>
          <Ico className="icon" aria-hidden />
          {label}
          {n && (
            <span className="n" aria-label={`${n} ${label}`}>
              {n}
            </span>
          )}
        </button>
      ))}
    </nav>
  );

  return (
    <Shell title={tab === 'table' ? 'Mesas' : tab === 'tab' ? 'Comandas' : 'Minhas mesas'} nav={bottomNav}>
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
        <div className="wgrid">
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
            <div className="wgrid">{tabs.map((o) => tile(o, 'tab', o.tableLabel ?? '?', () => goOrder(o)))}</div>
          )}
        </>
      )}
      {tab === 'mine' &&
        (mine.length === 0 ? (
          <Empty compact icon={UserRound} title="Você ainda não abriu mesas hoje" />
        ) : (
          <div className="wgrid">{mine.map((o) => tile(o, o.tabKind, o.tableLabel ?? '?', () => goOrder(o)))}</div>
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
      action={
        o && o.status === 'open' ? (
          <Button size="sm" icon={ReceiptText} onClick={requestBill} disabled={!!o.billRequestedAt || action.busy} aria-label={o.billRequestedAt ? 'Conta pedida' : 'Pedir a conta'}>
            {o.billRequestedAt ? 'Pedida' : 'Conta'}
          </Button>
        ) : null
      }
      foot={
        !closed && (
          <>
            <div className="wsum">
              <span>
                {o ? (
                  <>
                    Mesa: <b>{formatBRL(o.totalCents)}</b>
                  </>
                ) : (
                  'Mesa ainda sem pedido'
                )}
              </span>
              {draft.lines.length > 0 ? (
                <span className="draft">
                  Rascunho: {draftCount} {draftCount === 1 ? 'item' : 'itens'} · {formatBRL(draftTotal)}
                </span>
              ) : (
                <span>Nada no rascunho</span>
              )}
            </div>
            <div className="wactions">
              <Button size="lg" icon={Plus} disabled={locked} onClick={() => setPicking(true)} aria-label="Adicionar produtos">
                Produtos
              </Button>
              <Button
                variant={draft.state === 'unconfirmed' ? 'danger' : 'primary'}
                className={draft.state === 'unconfirmed' ? 'solid' : undefined}
                size="lg"
                icon={draft.state === 'unconfirmed' ? CloudOff : Send}
                disabled={!draft.lines.length || draft.state === 'sending'}
                onClick={() => setReview(true)}
              >
                {draft.state === 'unconfirmed' ? 'Reenviar pedido' : `Conferir e enviar${draftCount ? ` (${draftCount})` : ''}`}
              </Button>
            </div>
          </>
        )
      }
    >
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

      <section aria-label="Novo pedido" className={'wsec draft' + (draft.lines.length ? '' : ' empty-draft')}>
        <div className="wsec-head">
          <b>Novo pedido</b>
          {draft.lines.length > 0 ? <span className="badge orange">rascunho · ainda não enviado</span> : <small className="muted">vazio</small>}
          <span className="spacer" />
          {draft.lines.length > 0 && <b className="money">{formatBRL(draftTotal)}</b>}
        </div>
        <div className="wsec-body">
          {draft.lines.length === 0 && (
            <p className="muted" style={{ margin: '10px 0' }}>
              Toque em <b>Adicionar produtos</b> (embaixo). Os itens ficam guardados neste aparelho até você enviar.
            </p>
          )}
          {locked && draft.state === 'unconfirmed' && <p className="muted" style={{ margin: '10px 0 0' }}>Rascunho travado até a confirmação do envio, para evitar pedido duplicado.</p>}
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
        </div>
      </section>

      {o && o.tickets.length + noKitchen.length > 0 && (
        <section aria-label="Já enviado" style={{ marginTop: 4 }}>
          <h2 className="section-title">Já enviado</h2>
          <div>
            {[...o.tickets].reverse().map((t) => {
              const its = o.items.filter((i) => i.ticketId === t.id);
              return (
                <div key={t.id} className={'wsec' + (t.status === 'ready' && !t.servedAt ? ' ready' : '')}>
                  <div className="wsec-head">
                    <b>Rodada {t.round}</b>
                    <small className="muted">
                      {formatTime(t.createdAt)} · {shortName(t.createdByName)}
                    </small>
                    <span className="spacer" />
                    {ROUND_LABEL(t)}
                  </div>
                  <div className="wsec-body">
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
                    <Button variant="success" block size="lg" icon={Check} busy={action.busy} onClick={() => served(t)} style={{ margin: '4px 0 12px' }}>
                      Entregue na mesa
                    </Button>
                  )}
                  </div>
                </div>
              );
            })}
            {noKitchen.length > 0 && (
              <div className="wsec">
                <div className="wsec-head">
                  <b>Sem preparo</b>
                  <small className="muted">bebidas e outros · entregues direto</small>
                </div>
                <div className="wsec-body">
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
        <Button variant={count ? 'primary' : undefined} block size="lg" icon={count ? Check : undefined} onClick={onClose}>
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

// ---------------------------------------------------------------- pedidos do WhatsApp

/** Texto para o atendente mandar ao cliente pelo WhatsApp do próprio celular (sem integração paga). */
export function whatsAppSummary(o: Order, storeName: string, etaMinutes: number | null): string {
  const items = o.items.filter((i) => i.status === 'active').map((i) => {
    const opts = i.options.map((x) => (/^sem /i.test(x.optionName) ? x.optionName.toLowerCase() : `+ ${x.optionName}`)).join(', ');
    return `• ${i.quantity}x ${i.productName}${i.variantName ? ` (${i.variantName})` : ''}${opts ? ` (${opts})` : ''}`;
  });
  const where = o.type === 'delivery' ? `Entrega: ${o.addrStreet}, ${o.addrNumber}${o.addrComplement ? ` - ${o.addrComplement}` : ''} - ${o.neighborhoodName}` : 'Retirada no balcão';
  return [
    `Olá${o.customerName ? `, ${o.customerName.split(' ')[0]}` : ''}! Seu pedido #${o.number} no ${storeName} foi recebido e já está na cozinha:`,
    ...items,
    o.type === 'delivery' ? `Taxa de entrega: ${formatBRL(o.deliveryFeeCents)}` : '',
    `Total: ${formatBRL(o.totalCents)}`,
    o.paidCents > 0 ? `Já pago: ${formatBRL(o.paidCents)} · Falta: ${formatBRL(o.balanceCents)}` : '',
    o.paymentPlan?.length
      ? `Pagamento: ${formatPlan(o.paymentPlan)}${o.changeForCents ? ` (troco para ${formatBRL(o.changeForCents)})` : ''}`
      : o.paymentIntent ? `Pagamento: ${PAYMENT_METHOD_LABEL[o.paymentIntent]}${o.changeForCents ? ` (troco para ${formatBRL(o.changeForCents)})` : ''}` : '',
    where,
    etaMinutes ? `Previsão: cerca de ${etaMinutes} min.` : '',
    'Obrigado!',
  ].filter(Boolean).join('\n');
}
const waLink = (phone: string | null, text: string) => {
  const p = phone ? normalizePhoneBR(phone) : null;
  return `https://wa.me/${p ?? ''}?text=${encodeURIComponent(text)}`;
};

type Channel = 'whatsapp' | 'balcao';
const CH = {
  whatsapp: { title: 'Atendente do celular', sub: 'pedidos por WhatsApp e telefone: entrega ou retirada', new: 'Novo pedido (WhatsApp/telefone)', empty: 'Nenhum pedido por WhatsApp/telefone hoje' },
  balcao: { title: 'Balcão · para levar', sub: 'cliente na loja que vai levar (sem mesa)', new: 'Novo pedido para levar', empty: 'Nenhum pedido para levar hoje' },
} as const;

function WhatsAppOrders({ channel }: { channel: Channel }) {
  const nav = useNavigate();
  const { me } = useAuth();
  const c = CH[channel];
  const day = useDay();
  const dayId = day.data?.day?.id;
  const list = useQuery({
    queryKey: ['orders', channel, dayId],
    queryFn: () => get<OrderRow[]>(`/api/orders${qs({ dayId, status: 'pending,open,closed', limit: 100 })}`),
    enabled: !!dayId,
    refetchInterval: 30_000,
  });
  // balcão: pedidos para levar lançados pela equipe (não WhatsApp); o atendente vê os dele
  const rows = (list.data ?? []).filter((o) =>
    channel === 'whatsapp' ? o.source === 'whatsapp' : o.source === 'pos' && o.type === 'takeout' && (o.createdByName === me?.name || me?.role !== 'waiter'),
  );
  return (
    <Shell title={c.title} subtitle={c.sub} back="/atendente"
      foot={<Button variant="primary" size="lg" block icon={Plus} onClick={() => nav(`/atendente/${channel}/novo`)} disabled={!dayId}>{c.new}</Button>}>
      {!dayId && !day.isLoading && <Alert kind="warn">O dia ainda não foi aberto no caixa. Peça para abrir o dia antes de lançar pedidos.</Alert>}
      {channel === 'whatsapp' ? (
        <Alert kind="info" icon={MessageCircle}>
          Cliente pediu pelo WhatsApp ou ligou? Toque em <b>Novo pedido</b>, coloque os itens, o endereço e o <b>bairro</b>: o sistema mostra o{' '}
          <b>valor total com a taxa de entrega</b>. Envie e sai na cozinha na hora; depois <b>Avisar no WhatsApp</b> manda o resumo ao cliente.
        </Alert>
      ) : (
        <Alert kind="info" icon={ShoppingBag}>
          Cliente no balcão que vai levar? Toque em <b>Novo pedido para levar</b>, lance os itens e envie: sai na cozinha na hora. O cliente
          paga no caixa e retira quando ficar pronto.
        </Alert>
      )}
      {list.isLoading ? <Loading /> : rows.length === 0 ? (
        <Empty compact title={c.empty} />
      ) : (
        <div className="wa-orders">
          {rows.map((o) => (
            <div key={o.id} className="wa-order">
              <div>
                <b>#{o.number}</b> {o.customerName ?? 'Cliente'} <small className="muted">· {o.type === 'delivery' ? 'Entrega' : 'Retirada'} · {formatTime(o.createdAt)}</small>
                <br />
                <small>{o.status === 'closed' ? 'Finalizado' : ORDER_STAGE_LABEL[o.stage as keyof typeof ORDER_STAGE_LABEL] ?? o.stage} · <b>{formatBRL(o.totalCents)}</b></small>
              </div>
              {channel === 'whatsapp' && <WaNotify orderId={o.id} />}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

/** Abre o WhatsApp do celular com o resumo do pedido pronto para enviar ao cliente. */
function WaNotify({ orderId, big }: { orderId: string; big?: boolean }) {
  const o = useOrder(orderId);
  const s = useSettings();
  if (!o.data) return null;
  const eta = o.data.etaAt ? Math.max(5, Math.round((new Date(o.data.etaAt).getTime() - Date.now()) / 60000)) : null;
  return (
    <a className={'btn wa-btn' + (big ? ' lg block' : ' sm')} href={waLink(o.data.customerPhone, whatsAppSummary(o.data, s.data?.storeName ?? 'Bar do Guto', eta))} target="_blank" rel="noreferrer">
      <MessageCircle className="icon" aria-hidden /> Avisar no WhatsApp
    </a>
  );
}

function WhatsAppNew({ channel }: { channel: Channel }) {
  const wa = channel === 'whatsapp';
  const qc = useQueryClient();
  const menu = useMenu();
  const { busy, go } = useAction();
  const [delivery, setDelivery] = useState(false);
  const [cust, setCust] = useState<CustomerDraft>(emptyCustomer);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [picker, setPicker] = useState(false);
  const [picking, setPicking] = useState<{ product: MenuProduct; line?: CartLine } | null>(null);
  const { can } = useAuth();
  const ui = useUi();
  const [parts, setParts] = useState<PlanPart[]>([]);
  const [changeFor, setChangeFor] = useState('');
  const [notes, setNotes] = useState('');
  const [sent, setSent] = useState<Order | null>(null);
  const idem = useRef(newIdemKey());
  const products = useMemo(() => (menu.data ?? []).flatMap((c) => c.products), [menu.data]);
  const nbs = useNeighborhoods();
  const itemsTotal = lines.reduce((a, l) => a + lineTotal(l), 0);
  const nb = delivery ? nbs.data?.find((n) => n.id === cust.neighborhoodId) : undefined;
  const fee = nb?.feeCents ?? 0;
  const total = itemsTotal + fee;
  const paidNow = parts.filter((p) => p.paid).reduce((a, p) => a + (p.amountCents ?? 0), 0);
  const cashDue = parts.filter((p) => p.method === 'cash' && !p.paid).reduce((a, p) => a + (p.amountCents ?? 0), 0);
  const planSum = parts.reduce((a, p) => a + (p.amountCents ?? 0), 0);
  const changeForCents = changeFor.trim() ? Math.round(Number(changeFor.replace(/\./g, '').replace(',', '.')) * 100) || 0 : 0;
  // WhatsApp: nome e telefone obrigatórios (para avisar); balcão: só o nome para chamar na retirada (opcional)
  const phoneOk = wa ? !!normalizePhoneBR(cust.phone) : !cust.phone.trim() || !!normalizePhoneBR(cust.phone);
  const nameOk = wa ? !!cust.name.trim() : true;
  const addrOk = !delivery || (cust.street.trim() && cust.number.trim() && cust.neighborhoodId);
  const planOk = planSum <= total;
  const ready = lines.length > 0 && nameOk && phoneOk && addrOk && planOk;
  const missing = [!nameOk && 'nome', !phoneOk && 'telefone', !addrOk && 'endereço', !lines.length && 'itens', !planOk && 'acertar o pagamento'].filter(Boolean).join(', ');

  if (sent)
    return (
      <Shell title={`Pedido #${sent.number} na cozinha`} back={`/atendente/${channel}`} foot={wa ? <WaNotify orderId={sent.id} big /> : undefined}>
        <div className="pay-done">
          <CheckCircle2 size={44} color="var(--ok)" aria-hidden />
          <p className="pay-done-total">{formatBRL(sent.totalCents)}</p>
          <p className="muted">{[sent.customerName, formatPhoneBR(sent.customerPhone), sent.type === 'delivery' ? 'Entrega' : 'Para levar'].filter(Boolean).join(' · ')}</p>
          {wa ? (
            <p>Enviado para a cozinha. Agora avise o cliente pelo WhatsApp (abre o WhatsApp do celular com o resumo pronto).</p>
          ) : (
            <p>Enviado para a cozinha. Diga ao cliente o número <b>#{sent.number}</b> e peça para pagar no caixa; ele retira quando ficar pronto.</p>
          )}
          <Button onClick={() => { setSent(null); setLines([]); setCust(emptyCustomer); setNotes(''); setParts([]); setChangeFor(''); idem.current = newIdemKey(); }}>Lançar outro pedido</Button>
        </div>
      </Shell>
    );

  const submit = () =>
    go(async () => {
      const cents = changeForCents || null;
      const body = {
        type: delivery ? 'delivery' : 'takeout',
        ...customerPayload(cust, delivery),
        notes: notes.trim() || null,
        items: lines.map(lineToItemInput),
        send: true,
        source: wa ? 'whatsapp' : 'pos',
        // pagamento em partes: o combinado vai junto; o que já foi pago é registrado logo depois
        paymentPlan: parts.filter((p) => p.amountCents && p.amountCents > 0).map((p) => ({ method: p.method, amountCents: p.amountCents })),
        paymentIntent: (parts.find((p) => !p.paid) ?? parts[0])?.method ?? null,
        changeForCents: cashDue && cents ? cents : null,
        confirmDuplicate: true,
      };
      let o = await post<Order>('/api/orders', body, { idempotencyKey: idem.current });
      for (const p of parts.filter((x) => x.paid && x.amountCents)) {
        try {
          const r = await post<{ order: Order }>(`/api/orders/${o.id}/payments`, { method: p.method, amountCents: p.amountCents, tenderedCents: null, payerLabel: 'pago antes' }, { idempotencyKey: newIdemKey() });
          o = r.order;
        } catch (e) {
          ui.toast(`Pedido enviado, mas o pagamento já feito (${PAYMENT_METHOD_LABEL[p.method]}) não foi registrado: ${(e as Error).message}. Registre no caixa.`, 'error');
        }
      }
      qc.setQueryData(['order', o.id], o);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      setSent(o);
    }, { success: 'Pedido enviado para a cozinha' });

  return (
    <Shell
      title={CH[channel].new}
      back={`/atendente/${channel}`}
      foot={
        <div className="wactions wa-send">
          <Button size="lg" icon={Plus} onClick={() => setPicker(true)} aria-label="Adicionar produtos">Produtos</Button>
          <Button variant="primary" size="lg" icon={Send} busy={busy} disabled={!ready} onClick={submit} aria-label={ready ? `Enviar para a cozinha · ${formatBRL(total)}` : `Falta: ${missing}`}>
            {ready ? `Enviar · ${formatBRL(total)}` : `Falta: ${missing}`}
          </Button>
        </div>
      }
    >
      <section className="wsec">
        <h3>Cliente {!wa && <small className="muted">· opcional (nome para chamar na retirada)</small>}</h3>
        {wa && (
          <div className="seg-row" role="group" aria-label="Retirada ou entrega">
            <button type="button" aria-pressed={!delivery} onClick={() => setDelivery(false)}>Retirada na loja</button>
            <button type="button" aria-pressed={delivery} onClick={() => setDelivery(true)}>Entrega</button>
          </div>
        )}
        <CustomerFields value={cust} onChange={setCust} delivery={wa && delivery} />
      </section>
      <section className="wsec">
        <h3>Itens {lines.length > 0 && <small className="muted">· {formatBRL(itemsTotal)}</small>}</h3>
        {lines.length === 0 ? (
          <Button block icon={Plus} onClick={() => setPicker(true)}>Adicionar produtos</Button>
        ) : (
          lines.map((l) => (
            <div key={l.key} className="draft-line">
              <div>
                <b>{l.quantity}x {l.productName}</b>{l.variantName ? ` (${l.variantName})` : ''}
                {l.options.length > 0 && <div><small className="muted">{l.options.map((o) => o.name).join(', ')}</small></div>}
                {l.notes && <div><small>“{l.notes}”</small></div>}
              </div>
              <span className="num">{formatBRL(lineTotal(l))}</span>
              <Stepper value={l.quantity} onChange={(q) => setLines((ls) => (q <= 0 ? ls.filter((x) => x.key !== l.key) : ls.map((x) => (x.key === l.key ? { ...x, quantity: q } : x))))} min={0} label={l.productName} />
            </div>
          ))
        )}
      </section>
      {lines.length > 0 && (
        <section className="wsec total-box" aria-live="polite" aria-label="Valor total">
          <dl>
            <dt>Itens</dt>
            <dd>{formatBRL(itemsTotal)}</dd>
            {delivery && (
              <>
                <dt>Taxa de entrega{nb ? ` (${nb.name})` : ''}</dt>
                <dd>{nb ? formatBRL(fee) : <span className="muted">escolha o bairro</span>}</dd>
              </>
            )}
            <dt className="grand">Total</dt>
            <dd className="grand">{formatBRL(total)}</dd>
            {parts.some((p) => p.paid) && (
              <>
                <dt>Já pago</dt>
                <dd>{formatBRL(paidNow)}</dd>
                <dt>Falta receber</dt>
                <dd>{formatBRL(Math.max(0, total - paidNow))}</dd>
              </>
            )}
            {cashDue && changeForCents > cashDue && (
              <>
                <dt>Troco (dinheiro {formatBRL(cashDue)}, paga com {formatBRL(changeForCents)})</dt>
                <dd>{formatBRL(changeForCents - cashDue)}</dd>
              </>
            )}
          </dl>
          {delivery && nb && <small className="muted">Previsão de entrega: ~{nb.etaMinutes} min</small>}
        </section>
      )}
      <section className="wsec">
        <h3>{wa ? 'Pagamento (na entrega/retirada)' : 'Pagamento (no caixa)'}</h3>
        <PaymentPlanEditor total={total} parts={parts} onChange={setParts} changeFor={changeFor} onChangeFor={setChangeFor} allowPaid={can('payments.create')} />
        <textarea style={{ marginTop: 8 }} placeholder="Observação do pedido (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} aria-label="Observação do pedido" />
      </section>
      {picker && (
        <ProductPicker
          products={products}
          draftLines={lines}
          onPick={(p) => setPicking({ product: p })}
          onQuickAdd={(l) => setLines((ls) => [...ls, l])}
          onClose={() => setPicker(false)}
        />
      )}
      {picking && (
        <ProductDialog
          product={picking.product}
          initial={picking.line}
          onClose={() => setPicking(null)}
          onConfirm={(line) => {
            setLines((ls) => [...ls, line]);
            setPicking(null);
          }}
        />
      )}
    </Shell>
  );
}
