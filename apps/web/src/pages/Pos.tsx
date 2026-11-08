import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bike, CheckCircle2, LayoutGrid, MapPin, MessageSquareText, Minus, Plus, Printer, Search, SearchX, ShoppingBag, ShoppingCart, Store, Trash2, UserRound, X } from 'lucide-react';
import { computeOrderTotals, formatBRL, ORDER_TYPE_LABEL, placeLabel, searchFilter, searchScore, type OrderType, orderRef, orderTitle } from '@guto/core';
import { Layout } from '../components/Layout';
import { CustomerFields, customerPayload, emptyCustomer, type CustomerDraft } from '../components/CustomerFields';
import { lineToItemInput, lineTotal, ProductDialog } from '../components/ProductDialog';
import { OrderDrawer } from '../components/OrderDrawer';
import { PaymentDialog } from '../components/PaymentDialog';
import { Alert, Button, Empty, ErrorBox, Field, Loading, Modal, useAction, useUi } from '../components/ui';
import { ApiError, get, newIdemKey, post, qs } from '../lib/api';
import { lineFromItem } from '../lib/repeat';
import { useDay, useMenu, useNeighborhoods, useOrder, useSettings } from '../lib/queries';
import type { CartLine, MenuProduct, Order, OrderRow } from '../lib/types';

const TYPES: OrderType[] = ['counter', 'takeout', 'delivery', 'table'];
const TYPE_ICON = { counter: Store, takeout: ShoppingBag, delivery: Bike, table: LayoutGrid } as const;
/** Balcão e retirada normalmente pagam na hora: a ação principal é cobrar. Mesa e entrega: enviar. */
const PAY_FIRST: OrderType[] = ['counter', 'takeout'];

type Product = MenuProduct & { catName: string };

export default function Pos() {
  const menu = useMenu();
  const day = useDay();
  const nbs = useNeighborhoods();
  const settings = useSettings();
  const qc = useQueryClient();
  const ui = useUi();
  const [params, setParams] = useSearchParams();
  const targetId = params.get('pedido'); // modo "adicionar à comanda"
  const target = useOrder(targetId);

  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [type, setType] = useState<OrderType>((params.get('tipo') as OrderType) || 'counter');
  const [table, setTable] = useState(params.get('mesa') ?? '');
  const [cust, setCust] = useState<CustomerDraft>(emptyCustomer);
  const [notes, setNotes] = useState('');
  const [picking, setPicking] = useState<{ product: MenuProduct; line?: CartLine } | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [created, setCreated] = useState<{ order: Order; pay: boolean } | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const idem = useRef(newIdemKey());
  const searchRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();

  // qualquer mudança no carrinho gera nova chave (é outro pedido); reenvio do MESMO carrinho reusa a chave
  useEffect(() => {
    idem.current = newIdemKey();
  }, [cart, type, table, cust, notes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F4') {
        e.preventDefault();
        void submit(false);
      }
      if (e.key === 'F9' && !targetId) {
        e.preventDefault();
        void submit(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const products = useMemo<Product[]>(() => (menu.data ?? []).flatMap((c) => c.products.map((p) => ({ ...p, catName: c.name }))), [menu.data]);
  const term = search.trim();
  // com busca digitada, procura em todas as categorias (evita "não achei" por estar no filtro errado)
  const visible = term ? searchFilter(products, term, (p) => p) : products.filter((p) => cat === 'all' || p.categoryId === cat);

  const delivery = type === 'delivery';
  const nb = nbs.data?.find((n) => n.id === cust.neighborhoodId);
  const preview = computeOrderTotals({
    items: cart.map((l) => ({ unitPriceCents: l.unitPriceCents, quantity: l.quantity, options: l.options })),
    discount: null,
    deliveryFeeCents: delivery && nb && !targetId ? nb.feeCents : 0,
  });

  const add = (p: MenuProduct) => {
    const needsChoice = p.variants.length > 1 || p.groups.some((g) => g.minSelect > 0);
    if (!p.available || p.variants.every((v) => !v.available)) {
      ui.toast(`${p.name} está indisponível`, 'error');
      return;
    }
    if (needsChoice) return setPicking({ product: p });
    const v = p.variants[0]!;
    setCart((c) => {
      const same = c.find((l) => l.variantId === v.id && l.options.length === 0 && !l.notes);
      if (same) return c.map((l) => (l === same ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l));
      return [...c, { key: Math.random().toString(36).slice(2), variantId: v.id, productName: p.name, variantName: v.name === 'Único' ? null : v.name, unitPriceCents: v.priceCents, options: [], quantity: 1, notes: '' }];
    });
  };

  /** Repete um pedido anterior do cliente com preços e disponibilidade de hoje (o servidor confere ao gravar). */
  const repeatOrder = async (id: string, number: number) => {
    try {
      const old = await get<Order>(`/api/orders/${id}`);
      const lines = old.items.filter((i) => i.status === 'active').map((i) => lineFromItem(i, products, i.quantity));
      const ok = lines.filter((l): l is CartLine => !!l);
      setCart((c) => [...c, ...ok]);
      const missingCount = lines.length - ok.length;
      ui.toast(
        missingCount ? `Pedido #${number} repetido: ${ok.length} item(ns). ${missingCount} item(ns) indisponível(is) ficou(aram) de fora.` : `Pedido #${number} repetido com os preços de hoje. Confira antes de enviar.`,
        missingCount ? 'error' : 'ok',
      );
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  };

  const reset = () => {
    setCart([]);
    setCust(emptyCustomer);
    setNotes('');
    setSearch('');
    setShowCart(false);
  };

  async function submit(pay: boolean) {
    if (!cart.length || busy) return;
    if (targetId && target.data) {
      const r = await run(() => post<Order>(`/api/orders/${targetId}/items`, { version: target.data!.version, items: cart.map(lineToItemInput) }), { success: 'Itens adicionados à comanda' }).catch(() => undefined);
      if (r) {
        qc.setQueryData(['order', r.id], r);
        reset();
        setParams({});
        setDrawer(r.id);
      }
      return;
    }
    if (missing.length) {
      if (missing.includes('dados de entrega')) setCustOpen(true);
      return;
    }
    const body: Record<string, unknown> = {
      type,
      tableLabel: type === 'table' ? table : null,
      notes: notes || null,
      items: cart.map(lineToItemInput),
      ...customerPayload(cust, delivery),
    };
    const send = async (confirmDuplicate: boolean) =>
      run((sup) => post<Order>('/api/orders', { ...body, confirmDuplicate, supervisor: sup }, { idempotencyKey: idem.current }), { success: 'Pedido registrado', silent: ['possible_duplicate', 'table_busy'] });
    let order: Order | undefined;
    try {
      order = await send(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'possible_duplicate') {
        const ok = await ui.confirm({
          title: 'Possível pedido duplicado',
          message: `${e.message} Deseja registrar mesmo assim?`,
          confirmLabel: 'Registrar novo pedido',
        });
        if (ok) {
          idem.current = newIdemKey();
          order = await send(true).catch(() => undefined);
        }
      } else if (e instanceof ApiError && e.code === 'table_busy' && e.details?.id) {
        const ok = await ui.confirm({ title: 'Mesa ocupada', message: `${e.message}. Abrir a comanda existente para adicionar estes itens?`, confirmLabel: 'Abrir comanda' });
        if (ok) setParams({ pedido: e.details.id });
      }
    }
    if (order) {
      qc.setQueryData(['order', order.id], order);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      reset();
      setCreated({ order, pay });
    }
  }

  const dayClosed = day.data && !day.data.day;
  const missing: string[] = [];
  if (!targetId) {
    if (type === 'table' && !table) missing.push('mesa');
    if (delivery && (!cust.name || !cust.street || !cust.number || !cust.neighborhoodId)) missing.push('dados de entrega');
    if (delivery && cust.greenSauce === null) missing.push('molho verde');
  }

  if (menu.isLoading) return <Layout title="Venda"><Loading /></Layout>;
  if (menu.error) return <Layout title="Venda"><ErrorBox error={menu.error} retry={() => menu.refetch()} /></Layout>;


  const qtyByProduct = new Map<string, number>();
  for (const l of cart) {
    const p = products.find((x) => x.variants.some((v) => v.id === l.variantId));
    if (p) qtyByProduct.set(p.id, (qtyByProduct.get(p.id) ?? 0) + l.quantity);
  }
  const itemsCount = cart.reduce((a, l) => a + l.quantity, 0);
  const canSend = cart.length > 0 && !dayClosed;
  const payFirst = !targetId && PAY_FIRST.includes(type);
  const setQty = (key: string, q: number) => setCart((c) => (q <= 0 ? c.filter((x) => x.key !== key) : c.map((x) => (x.key === key ? { ...x, quantity: Math.min(99, q) } : x))));
  const editLine = (l: CartLine) => {
    const p = products.find((x) => x.variants.some((v) => v.id === l.variantId));
    if (p) setPicking({ product: p, line: l });
  };

  const cats = menu.data!;
  const catTabs = (
    <div className="pos-cats" role="group" aria-label="Categorias">
      <button type="button" aria-pressed={cat === 'all' && !term} onClick={() => { setCat('all'); setSearch(''); }}>
        Todos <span className="count">{products.length}</span>
      </button>
      {cats.map((c) => (
        <button key={c.id} type="button" aria-pressed={cat === c.id && !term} onClick={() => { setCat(c.id); setSearch(''); }}>
          {c.name} <span className="count">{c.products.length}</span>
        </button>
      ))}
    </div>
  );

  const productLabel = (p: Product, min: number, off: boolean, qty?: number) => `${p.name}, ${formatBRL(min)}${off ? ', indisponível' : ''}${qty ? `, ${qty} no pedido` : ''}`;

  const catalog = (
    <div className="pos-grid">
      {visible.length === 0 && (
        <Empty icon={SearchX} title="Nenhum produto encontrado">
          {term ? <span>Confira a grafia ou busque pelo código.</span> : null}
        </Empty>
      )}
      {visible.map((p) => {
        const off = !p.available || p.variants.every((v) => !v.available);
        const min = Math.min(...p.variants.map((v) => v.priceCents));
        const qty = qtyByProduct.get(p.id);
        return (
          <button key={p.id} type="button" className={'ptile' + (off ? ' off' : '') + (qty ? ' sel' : '')} onClick={() => add(p)} aria-label={productLabel(p, min, off, qty)}>
            <span className="ptile-name">{p.name}</span>
            <span className="ptile-foot">
              <span className="ptile-price">
                {off ? (
                  'Indisponível'
                ) : (
                  <>
                    {p.variants.length > 1 && <small>a partir de </small>}
                    {formatBRL(min)}
                  </>
                )}
              </span>
              {p.code && <span className="ptile-code">{p.code}</span>}
            </span>
            {qty ? (
              <span className="ptile-qty" aria-hidden>
                {qty}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  const custSummary = cust.name || cust.phone ? [cust.name, cust.phone].filter(Boolean).join(' · ') : null;
  const addrSummary = cust.street ? `${cust.street}, ${cust.number}${nb ? ' — ' + nb.name : ''}` : null;

  return (
    <Layout bare>
      <div className="pos">
        <section className="pos-catalog" aria-label="Produtos">
          <header className="pos-head">
            <div className="pos-search">
              <Search className="icon" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                placeholder="Buscar produto por nome ou código"
                value={search}
                aria-label="Buscar produto"
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && visible.length >= 1 && (visible.length === 1 || searchScore(search, visible[0]!.name, visible[0]!.code) >= 50)) {
                    add(visible[0]!);
                    setSearch('');
                  }
                  if (e.key === 'Escape') setSearch('');
                }}
              />
              {search ? (
                <button type="button" className="pos-search-clear" aria-label="Limpar busca" onClick={() => setSearch('')}>
                  <X size={16} aria-hidden />
                </button>
              ) : (
                <kbd>F2</kbd>
              )}
            </div>
            {catTabs}
          </header>
          {dayClosed && (
            <div style={{ padding: '10px 16px 0' }}>
              <Alert kind="warn" action={<a className="btn sm" href="/caixa">Abrir o dia</a>}>
                O dia operacional está fechado. Abra o dia para registrar pedidos.
              </Alert>
            </div>
          )}
          {catalog}
          <div className="pos-mobile-bar">
            <span className="pos-mobile-total">
              <small>{itemsCount} {itemsCount === 1 ? 'item' : 'itens'}</small>
              <b>{formatBRL(preview.totalCents)}</b>
            </span>
            <Button variant="primary" icon={ShoppingCart} onClick={() => setShowCart(true)}>
              Ver pedido
            </Button>
          </div>
        </section>

        <section className={'pos-order' + (showCart ? ' show' : '')} aria-label="Pedido atual">
          <header className="order-head">
            <div className="order-title">
              {showCart && <Button size="sm" variant="ghost" icon={ArrowLeft} aria-label="Voltar aos produtos" onClick={() => setShowCart(false)} />}
              <h2>{targetId ? `Acrescentar ao pedido #${target.data?.number ?? '…'}` : 'Pedido'}</h2>
              <span className="order-count">{itemsCount ? `${itemsCount} ${itemsCount === 1 ? 'item' : 'itens'}` : 'vazio'}</span>
              <span className="spacer" />
              <Button size="sm" variant="ghost" icon={Trash2} onClick={reset} disabled={!cart.length} title="Limpar pedido">
                Limpar
              </Button>
            </div>
            {targetId ? (
              <div className="order-context">
                <span className="ctx-chip">{target.data?.place ?? '…'}</span>
                <button type="button" className="ctx-link" onClick={() => setParams({})}>
                  Cancelar e começar pedido novo
                </button>
              </div>
            ) : (
              <>
                <div className="mode-switch" role="group" aria-label="Tipo de pedido">
                  {TYPES.map((t) => {
                    const Ico = TYPE_ICON[t];
                    return (
                      <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
                        <Ico className="icon" aria-hidden />
                        {ORDER_TYPE_LABEL[t]}
                      </button>
                    );
                  })}
                </div>
                <div className="order-context">
                  {type === 'table' && (
                    <label className={'ctx-select' + (!table ? ' need' : '')}>
                      <LayoutGrid size={15} aria-hidden />
                      <span className="sr-only">Mesa</span>
                      <select value={table} onChange={(e) => setTable(e.target.value)} aria-label="Mesa">
                        <option value="">Escolher mesa…</option>
                        {(settings.data?.tables ?? []).map((t: string) => (
                          <option key={t} value={t}>
                            Mesa {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button type="button" className={'ctx-chip button' + (delivery && missing.includes('dados de entrega') ? ' need' : '')} onClick={() => setCustOpen(true)}>
                    {delivery ? <MapPin size={15} aria-hidden /> : <UserRound size={15} aria-hidden />}
                    <span className="ellipsis">{delivery ? (addrSummary ?? 'Informar cliente e endereço') : (custSummary ?? 'Cliente (opcional)')}</span>
                  </button>
                  {(notes || !delivery) && (
                    <button type="button" className={'ctx-chip button' + (notes ? ' filled' : '')} onClick={() => setCustOpen(true)} title="Observação do pedido">
                      <MessageSquareText size={15} aria-hidden />
                      <span className="ellipsis">{notes || 'Observação'}</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </header>

          <div className="order-lines">
            {cart.length === 0 ? (
              <>
                <div className="order-empty">
                  <ShoppingCart className="icon" aria-hidden />
                  <b>Nenhum item no pedido</b>
                  <span>Toque nos produtos ou digite o código e tecle Enter.</span>
                  <span className="keys">
                    <span><kbd>F2</kbd> buscar</span>
                    <span><kbd>F4</kbd> enviar</span>
                    <span><kbd>F9</kbd> cobrar</span>
                  </span>
                </div>
                {!targetId && <RecentOrders dayId={day.data?.day?.id} onOpen={setDrawer} />}
              </>
            ) : (
              <ol className="lines">
                {cart.map((l) => (
                  <li key={l.key} className="line">
                    <span className="qty-ctl">
                      <button type="button" aria-label={`Menos ${l.productName}`} onClick={() => setQty(l.key, l.quantity - 1)}>
                        {l.quantity > 1 ? <Minus size={14} aria-hidden /> : <Trash2 size={13} aria-hidden />}
                      </button>
                      <b>{l.quantity}</b>
                      <button type="button" aria-label={`Mais ${l.productName}`} onClick={() => setQty(l.key, l.quantity + 1)}>
                        <Plus size={14} aria-hidden />
                      </button>
                    </span>
                    <button type="button" className="line-main" aria-label={`Editar ${l.productName}`} onClick={() => editLine(l)}>
                      <span className="line-name">
                        {l.productName}
                        {l.variantName ? ` (${l.variantName})` : ''}
                      </span>
                      {l.options.length > 0 && <span className="line-opts">{l.options.map((o) => (o.quantity > 1 ? `${o.quantity}× ` : '+ ') + o.name).join('  ·  ')}</span>}
                      {l.notes && <span className="line-note">“{l.notes}”</span>}
                      <span className="line-unit">{formatBRL(lineTotal(l) / l.quantity)} cada</span>
                    </button>
                    <span className="line-total">{formatBRL(lineTotal(l))}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <footer className="order-foot">
            <dl className="order-sum">
              <dt>Itens</dt>
              <dd>{formatBRL(preview.subtotalCents)}</dd>
              {delivery && !targetId && (
                <>
                  <dt>Taxa de entrega{nb ? ` · ${nb.name}` : ''}</dt>
                  <dd>{nb ? formatBRL(preview.deliveryFeeCents) : '—'}</dd>
                </>
              )}
              <dt className="grand">Total</dt>
              <dd className="grand">{formatBRL(preview.totalCents)}</dd>
            </dl>
            {missing.length > 0 && cart.length > 0 && (
              <p className="order-missing" role="status">
                Falta informar: <b>{missing.join(', ')}</b>
              </p>
            )}
            {targetId ? (
              <Button variant="primary" size="lg" block busy={busy} disabled={!canSend} onClick={() => void submit(false)} kbd="F4">
                Adicionar e enviar
              </Button>
            ) : payFirst ? (
              <div className="order-actions">
                <Button variant="primary" size="lg" busy={busy} disabled={!canSend} onClick={() => void submit(true)} kbd="F9" className="act-primary">
                  Cobrar {cart.length ? formatBRL(preview.totalCents) : ''}
                </Button>
                <Button busy={busy} disabled={!canSend} onClick={() => void submit(false)} kbd="F4" className="act-secondary">
                  Enviar pedido
                </Button>
              </div>
            ) : (
              <div className="order-actions">
                <Button variant="primary" size="lg" busy={busy} disabled={!canSend} onClick={() => void submit(false)} kbd="F4" className="act-primary">
                  Enviar pedido
                </Button>
                <Button busy={busy} disabled={!canSend} onClick={() => void submit(true)} kbd="F9" className="act-secondary">
                  Enviar e cobrar
                </Button>
              </div>
            )}
          </footer>
        </section>
      </div>

      {custOpen && (
        <Modal
          title={delivery ? 'Cliente e endereço de entrega' : 'Cliente e observação'}
          onClose={() => setCustOpen(false)}
          footer={
            <Button variant="primary" onClick={() => setCustOpen(false)}>
              Concluir
            </Button>
          }
        >
          <CustomerFields value={cust} onChange={setCust} delivery={delivery} onRepeat={(id, n) => void repeatOrder(id, n)} />
          <Field label="Observação do pedido">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Ex.: cliente aguarda no balcão" />
          </Field>
        </Modal>
      )}
      {picking && (
        <ProductDialog
          product={picking.product}
          initial={picking.line}
          onClose={() => setPicking(null)}
          onConfirm={(line) => {
            setCart((c) => (picking.line ? c.map((x) => (x.key === line.key ? line : x)) : [...c, line]));
            setPicking(null);
          }}
        />
      )}
      {created && !created.pay && (
        <Modal
          title={`${orderTitle(created.order)} registrado`}
          onClose={() => setCreated(null)}
          footer={
            <>
              <a className="btn" href={`/imprimir/${created.order.id}?via=cozinha&w=${settings.data?.printWidth ?? 80}`} target="_blank" rel="noreferrer">
                <Printer className="icon" aria-hidden /> Imprimir
              </a>
              <Button onClick={() => { setDrawer(created.order.id); setCreated(null); }}>Ver pedido</Button>
              <Button variant="success" onClick={() => setCreated({ ...created, pay: true })}>
                Cobrar agora
              </Button>
              <Button variant="primary" onClick={() => setCreated(null)}>
                Novo pedido
              </Button>
            </>
          }
        >
          <div style={{ textAlign: 'center' }}>
            <CheckCircle2 size={40} color="var(--ok)" aria-hidden />
            <p style={{ fontSize: '2.6rem', fontWeight: 800, margin: '4px 0 0', letterSpacing: '-.02em' }}>{orderRef(created.order)}</p>
            <p className="muted">
              {created.order.place} · Total <b className="money" style={{ color: 'var(--ink)' }}>{formatBRL(created.order.totalCents)}</b> ·{' '}
              {created.order.tickets.length ? 'enviado à cozinha' : 'sem itens de cozinha'}
            </p>
          </div>
        </Modal>
      )}
      {created?.pay && (
        <PaymentDialog
          order={created.order}
          onClose={() => setCreated(null)}
          onPaid={(o) => {
            qc.setQueryData(['order', o.id], o);
            // quitado: o próprio diálogo mostra o troco e o botão Imprimir nota
            if (o.balanceCents > 0) setCreated({ order: o, pay: true });
          }}
        />
      )}
      {drawer && <OrderDrawer orderId={drawer} onClose={() => setDrawer(null)} />}
    </Layout>
  );
}

/** Últimos pedidos do dia: reabrir para cobrar, imprimir ou acrescentar sem sair do PDV. */
function RecentOrders({ dayId, onOpen }: { dayId?: string; onOpen: (id: string) => void }) {
  const q = useQuery({
    queryKey: ['orders', 'recentes', dayId],
    queryFn: () => get<OrderRow[]>('/api/orders' + qs({ dayId, status: 'open,pending,closed', limit: 6 })),
    enabled: !!dayId,
    refetchInterval: 30000,
  });
  const list = q.data ?? [];
  if (!list.length) return null;
  return (
    <section className="recent" aria-label="Últimos pedidos">
      <h3>Últimos pedidos</h3>
      <ul>
        {list.map((o) => {
          const due = o.totalCents - o.paidCents;
          return (
            <li key={o.id}>
              <button type="button" onClick={() => onOpen(o.id)} aria-label={`Abrir pedido ${o.number}`}>
                <b className="r-num">{orderRef(o)}</b>
                <span className="r-place ellipsis">{placeLabel(o)}{o.customerName ? ` · ${o.customerName}` : ''}</span>
                <span className="r-state">
                  {o.status === 'pending' ? (
                    <span className="badge orange">aceitar</span>
                  ) : o.status === 'closed' ? (
                    <span className="badge">finalizado</span>
                  ) : due > 0 ? (
                    <span className="badge warn">a receber</span>
                  ) : (
                    <span className="badge green">pago</span>
                  )}
                </span>
                <span className="r-total">{formatBRL(o.totalCents)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
