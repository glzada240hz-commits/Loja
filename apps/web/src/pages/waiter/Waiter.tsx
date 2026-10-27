import { useMemo, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBRL, placeLabel, unitTotal } from '@guto/core';
import { ConnectionPill } from '../../components/Layout';
import { Logo } from '../../components/Logo';
import { lineToItemInput, lineTotal, ProductDialog } from '../../components/ProductDialog';
import { Button, Chips, Empty, ErrorBox, Field, Loading, Modal, Stepper, useAction, useUi } from '../../components/ui';
import { ApiError, get, newIdemKey, post, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatTime, minutesSince } from '../../lib/format';
import { useConnection } from '../../lib/live';
import { useDay, useMenu, useOrder, useSettings } from '../../lib/queries';
import type { CartLine, MenuProduct, Order, OrderRow, Ticket } from '../../lib/types';
import { moveDraft, useDraft } from './draft';

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

function Shell({ title, back, children, foot }: { title: ReactNode; back?: string; children: ReactNode; foot?: ReactNode }) {
  const { me, logout } = useAuth();
  const conn = useConnection();
  return (
    <div className="waiter">
      <header className="waiter-head">
        {back ? (
          <Link to={back} className="waiter-back" aria-label="Voltar">
            ←
          </Link>
        ) : (
          <Logo size={28} />
        )}
        <div className="waiter-title">
          <b>{title}</b>
          <small>{me?.name}</small>
        </div>
        <ConnectionPill />
        {!back && (
          <button type="button" className="waiter-logout" onClick={() => void logout()}>
            Sair
          </button>
        )}
      </header>
      {conn === 'offline' && (
        <div className="offline-banner" role="alert">
          Sem conexão. Nada é enviado à cozinha até a conexão voltar. Seu rascunho fica guardado neste aparelho.
        </div>
      )}
      <main className="waiter-body">{children}</main>
      {foot && <footer className="waiter-foot">{foot}</footer>}
    </div>
  );
}

// ---------------------------------------------------------------- mesas e comandas

function roundState(r: OrderRow['rounds']) {
  if (!r) return null;
  if (r.ready > 0) return <span className="badge green pulse">Pronto p/ servir</span>;
  if (r.preparing > 0) return <span className="badge yellow">Em preparo</span>;
  if (r.received > 0) return <span className="badge blue">Enviado</span>;
  if (r.served > 0) return <span className="badge dark">Entregue</span>;
  return null;
}

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
  if (day.isLoading || settings.isLoading) return <Shell title="Atendimento"><Loading /></Shell>;
  if (!day.data?.day) return <Shell title="Atendimento"><Empty title="O dia operacional ainda não foi aberto">Peça ao caixa para abrir o dia.</Empty></Shell>;
  const open = list.data ?? [];
  const tables: string[] = settings.data?.tables ?? [];
  const tabs = open.filter((o) => o.tabKind === 'tab');
  const mine = open.filter((o) => o.createdByName === me?.name);
  const tile = (o: OrderRow | undefined, label: string, onClick: () => void) => (
    <button key={label} type="button" className={'table-tile' + (o ? (o.rounds?.ready ? ' ready' : ' busy') : '')} onClick={onClick}>
      <span className="tnum">{label}</span>
      {o ? (
        <>
          <span>
            #{o.number} · {minutesSince(o.createdAt)} min
          </span>
          <b>{formatBRL(o.totalCents)}</b>
          <small>{o.createdByName ?? '—'}</small>
          <span className="hstack">
            {roundState(o.rounds)}
            {o.billRequestedAt && <span className="badge red">Conta pedida</span>}
          </span>
        </>
      ) : (
        <span className="muted">Livre</span>
      )}
    </button>
  );
  return (
    <Shell title="Atendimento">
      <Chips
        label="Mostrar"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'table', label: `Mesas (${open.filter((o) => o.tabKind === 'table').length}/${tables.length})` },
          { id: 'tab', label: `Comandas (${tabs.length})` },
          { id: 'mine', label: `Meus (${mine.length})` },
        ]}
      />
      <div style={{ height: 12 }} />
      {list.error && <ErrorBox error={list.error} retry={() => list.refetch()} />}
      {tab === 'table' && (
        <div className="tables-grid">
          {tables.map((t) => {
            const o = open.find((x) => x.tabKind === 'table' && x.tableLabel === t);
            return tile(o, `Mesa ${t}`, () => nav(o ? `/atendente/pedido/${o.id}` : `/atendente/nova/table/${encodeURIComponent(t)}`));
          })}
        </div>
      )}
      {tab === 'tab' && (
        <>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const label = newTab.trim();
              if (!label) return;
              const o = tabs.find((x) => x.tableLabel === label);
              nav(o ? `/atendente/pedido/${o.id}` : `/atendente/nova/tab/${encodeURIComponent(label)}`);
            }}
          >
            <Field label="Número da comanda">
              <input inputMode="numeric" value={newTab} onChange={(e) => setNewTab(e.target.value.slice(0, 20))} placeholder="ex.: 15" />
            </Field>
            <Button className="shrink" type="submit" variant="primary" disabled={!newTab.trim()}>
              Abrir
            </Button>
          </form>
          {tabs.length === 0 && <Empty title="Nenhuma comanda aberta" />}
          <div className="tables-grid">{tabs.map((o) => tile(o, `Comanda ${o.tableLabel}`, () => nav(`/atendente/pedido/${o.id}`)))}</div>
        </>
      )}
      {tab === 'mine' && (
        <>
          {mine.length === 0 && <Empty title="Você ainda não abriu mesas hoje" />}
          <div className="tables-grid">{mine.map((o) => tile(o, placeLabel(o), () => nav(`/atendente/pedido/${o.id}`)))}</div>
        </>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- pedido da mesa/comanda

const ROUND_LABEL = (t: Ticket) =>
  t.servedAt ? (
    <span className="badge dark">Entregue {formatTime(t.servedAt)}</span>
  ) : t.status === 'ready' ? (
    <span className="badge green pulse">Pronto</span>
  ) : t.status === 'preparing' ? (
    <span className="badge yellow">Em preparo</span>
  ) : (
    <span className="badge blue">Enviado · aguardando cozinha</span>
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
  const title = o ? `${o.place} · #${o.number}` : placeLabel({ type: 'table', tabKind: kind, tableLabel: label });
  const draftTotal = draft.lines.reduce((a, l) => a + lineTotal(l), 0);
  const draftCount = draft.lines.reduce((a, l) => a + l.quantity, 0);
  const locked = draft.state !== 'editing';

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

  if (orderId && order.isLoading) return <Shell title="Carregando…" back="/atendente"><Loading /></Shell>;
  if (orderId && order.error) return <Shell title="Pedido" back="/atendente"><ErrorBox error={order.error} retry={() => order.refetch()} /></Shell>;
  const closed = o && o.status !== 'open' && o.status !== 'pending';
  const noKitchen = o?.items.filter((i) => i.sentAt && !i.ticketId) ?? [];

  return (
    <Shell
      title={title}
      back="/atendente"
      foot={
        !closed && (
          <>
            {o && o.status === 'open' && (
              <Button onClick={requestBill} disabled={!!o.billRequestedAt || action.busy}>
                {o.billRequestedAt ? 'Conta pedida' : 'Pedir a conta'}
              </Button>
            )}
            <Button variant="primary" size="lg" style={{ flex: 1 }} disabled={!draft.lines.length || draft.state === 'sending'} onClick={() => setReview(true)}>
              {draft.state === 'unconfirmed' ? 'Reenviar pedido' : `Conferir e enviar${draftCount ? ` (${draftCount})` : ''}`}
            </Button>
          </>
        )
      }
    >
      {o && (
        <div className="hstack" style={{ marginBottom: 8 }}>
          <small className="muted">
            Aberta por <b>{o.createdByName}</b> às {formatTime(o.createdAt)}
          </small>
          <span className="spacer" />
          <b>Total {formatBRL(o.totalCents)}</b>
        </div>
      )}
      {closed && <div className="alert info">Este pedido está {o!.status === 'closed' ? 'finalizado' : 'cancelado'}.</div>}
      {o?.billRequestedAt && <div className="alert warn">Conta pedida ao caixa às {formatTime(o.billRequestedAt)}{o.billRequestedByName ? ` por ${o.billRequestedByName}` : ''}.</div>}

      {draft.state === 'sending' && (
        <div className="send-banner sending" role="status">
          <span className="spin" aria-hidden /> Enviando para o servidor… não feche o app.
        </div>
      )}
      {draft.state === 'unconfirmed' && (
        <div className="send-banner fail" role="alert">
          <b>Envio não confirmado.</b> {draft.error}
          <div style={{ marginTop: 8 }}>
            <Button variant="danger" onClick={send}>
              Reenviar agora
            </Button>
          </div>
        </div>
      )}
      {draft.state === 'editing' && draft.error && (
        <div className="send-banner fail" role="alert">
          <b>Não enviado:</b> {draft.error}
        </div>
      )}
      {confirmed && draft.state === 'editing' && !draft.error && (
        <div className="send-banner ok" role="status">
          ✓ Recebido pelo servidor às {formatTime(confirmed.at)} — {confirmed.count} item(ns){confirmed.round ? ` na rodada ${confirmed.round}` : ''}. Já aparece no caixa
          {confirmed.round ? ' e na cozinha' : ''}.
        </div>
      )}

      <section aria-label="Novo pedido" className="card">
        <div className="hstack">
          <h2 style={{ margin: 0 }}>Novo pedido</h2>
          <span className="spacer" />
          {draft.lines.length > 0 && <b>{formatBRL(draftTotal)}</b>}
        </div>
        {draft.lines.length === 0 && <p className="muted">Toque em “Adicionar produtos”. Os itens ficam guardados aqui até você enviar.</p>}
        {locked && draft.state === 'unconfirmed' && <p className="muted">Rascunho travado até a confirmação do envio, para evitar pedido duplicado.</p>}
        {draft.lines.map((l) => (
          <div key={l.key} className="cart-item">
            <Stepper label={l.productName} value={l.quantity} min={0} max={99} onChange={(v) => editLines((ls) => (v === 0 ? ls.filter((x) => x.key !== l.key) : ls.map((x) => (x.key === l.key ? { ...x, quantity: v } : x))))} />
            <button
              type="button"
              className="linkish"
              disabled={locked}
              onClick={() => {
                const p = products.find((x) => x.variants.some((v) => v.id === l.variantId));
                if (p) setEditing({ product: p, line: l });
              }}
            >
              <b>
                {l.productName}
                {l.variantName ? ` (${l.variantName})` : ''}
              </b>
              {l.options.length > 0 && <div className="opts">{l.options.map((x) => (x.quantity > 1 ? `${x.quantity}x ` : '') + x.name).join(', ')}</div>}
              {l.notes && <div className="note">“{l.notes}”</div>}
            </button>
            <span className="num">{formatBRL(lineTotal(l))}</span>
          </div>
        ))}
        {!closed && (
          <Button block style={{ marginTop: 10 }} disabled={locked} onClick={() => setPicking(true)}>
            + Adicionar produtos
          </Button>
        )}
      </section>

      {o && o.tickets.length + noKitchen.length > 0 && (
        <section aria-label="Já enviado" style={{ marginTop: 12 }}>
          <h2>Já enviado</h2>
          {o.tickets.map((t) => {
            const its = o.items.filter((i) => i.ticketId === t.id);
            return (
              <div key={t.id} className={'card round-card' + (t.status === 'ready' && !t.servedAt ? ' ready' : '')}>
                <div className="hstack">
                  <b>Rodada {t.round}</b>
                  <small className="muted">
                    {formatTime(t.createdAt)} · {t.createdByName ?? '—'}
                  </small>
                  <span className="spacer" />
                  {ROUND_LABEL(t)}
                </div>
                {t.changeNote && <div className="alert warn" style={{ margin: '6px 0' }}>Alteração: {t.changeNote}</div>}
                {its.map((i) => (
                  <div key={i.id} className={'order-line' + (i.status === 'cancelled' ? ' cancelled' : '')}>
                    <div>
                      <span className="name">
                        <b>{i.quantity}x</b> {i.productName}
                        {i.variantName ? ` (${i.variantName})` : ''}
                      </span>
                      {i.options.length > 0 && <div><small className="muted">{i.options.map((x) => x.optionName).join(', ')}</small></div>}
                      {i.notes && <div style={{ color: 'var(--orange)', fontSize: '.85rem' }}>“{i.notes}”</div>}
                      {i.status === 'cancelled' && <small className="muted">Cancelado: {i.cancelReason}</small>}
                    </div>
                    {i.status === 'active' && !closed && !t.servedAt && (
                      <button type="button" className="btn ghost sm" onClick={() => cancelSent(i.id, i.productName)}>
                        Cancelar
                      </button>
                    )}
                  </div>
                ))}
                {t.status === 'ready' && !t.servedAt && (
                  <Button variant="success" block busy={action.busy} onClick={() => served(t)} style={{ marginTop: 8 }}>
                    Entregue na mesa
                  </Button>
                )}
              </div>
            );
          })}
          {noKitchen.length > 0 && (
            <div className="card round-card">
              <b>Sem preparo (bebidas e outros)</b>
              {noKitchen.map((i) => (
                <div key={i.id} className={'order-line' + (i.status === 'cancelled' ? ' cancelled' : '')}>
                  <span className="name">
                    <b>{i.quantity}x</b> {i.productName}
                  </span>
                  <small className="muted">{i.createdByName}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {picking && (
        <ProductPicker
          products={products}
          onClose={() => setPicking(false)}
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
              <Button variant="success" size="lg" busy={draft.state === 'sending'} onClick={send}>
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
                {l.options.length > 0 && <div><small className="muted">{l.options.map((x) => x.name).join(', ')}</small></div>}
                {l.notes && <div style={{ color: 'var(--orange)' }}>“{l.notes}”</div>}
              </div>
              <span className="num">{formatBRL(unitTotal({ unitPriceCents: l.unitPriceCents, options: l.options }) * l.quantity)}</span>
            </div>
          ))}
          <div className="totals" style={{ marginTop: 10 }}>
            <b>Total deste envio</b>
            <b className="num">{formatBRL(draftTotal)}</b>
          </div>
          <small className="muted">O valor oficial é calculado pelo servidor. Só os itens acima serão enviados; o que já foi pedido não é reenviado.</small>
          {draft.state === 'unconfirmed' && <div className="alert error" style={{ marginTop: 8 }}>{draft.error}</div>}
        </Modal>
      )}
    </Shell>
  );
}

function ProductPicker({ products, onPick, onClose }: { products: MenuProduct[]; onPick: (p: MenuProduct) => void; onClose: () => void }) {
  const menu = useMenu();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const term = q.trim().toLowerCase();
  const list = products.filter((p) => (cat === 'all' || p.categoryId === cat) && (!term || p.name.toLowerCase().includes(term) || p.code === term));
  return (
    <Modal wide title="Adicionar produtos" onClose={onClose}>
      <input type="search" placeholder="Buscar produto ou código" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto" />
      <div className="chips" style={{ margin: '10px 0' }}>
        <button type="button" className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
          Todos
        </button>
        {menu.data?.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="pos-grid" style={{ padding: 0 }}>
        {list.map((p) => {
          const off = !p.available || p.variants.every((v) => !v.available);
          return (
            <button key={p.id} type="button" className={'prod' + (off ? ' off' : '')} disabled={off} onClick={() => onPick(p)} aria-label={`${p.name}${off ? ', indisponível' : ''}`}>
              <span className="name">{p.name}</span>
              <span className="price">{formatBRL(Math.min(...p.variants.map((v) => v.priceCents)))}</span>
            </button>
          );
        })}
      </div>
      {list.length === 0 && <Empty title="Nenhum produto encontrado" />}
    </Modal>
  );
}
