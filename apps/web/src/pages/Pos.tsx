import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bike, CheckCircle2, ChevronDown, LayoutGrid, MapPin, Minus, Pencil, Plus, Printer, Search, SearchX, ShoppingBag, ShoppingCart, Store, Trash2, UserRound } from 'lucide-react';
import { computeOrderTotals, formatBRL, ORDER_TYPE_LABEL, searchFilter, searchScore, type OrderType } from '@guto/core';
import { Layout } from '../components/Layout';
import { CustomerFields, customerPayload, emptyCustomer, type CustomerDraft } from '../components/CustomerFields';
import { lineToItemInput, lineTotal, ProductDialog } from '../components/ProductDialog';
import { OrderDrawer } from '../components/OrderDrawer';
import { PaymentDialog } from '../components/PaymentDialog';
import { Alert, Button, Empty, ErrorBox, Field, Loading, Modal, useAction, useUi } from '../components/ui';
import { ApiError, get, newIdemKey, post } from '../lib/api';
import { lineFromItem } from '../lib/repeat';
import { useDay, useMenu, useNeighborhoods, useOrder, useSettings } from '../lib/queries';
import type { CartLine, MenuProduct, Order } from '../lib/types';

const TYPES: OrderType[] = ['counter', 'takeout', 'delivery', 'table'];
const TYPE_ICON = { counter: Store, takeout: ShoppingBag, delivery: Bike, table: LayoutGrid } as const;
const CAT_COLORS = ['#ea580c', '#2563eb', '#16a34a', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#4f46e5'];
const catIndex = new Map<string, number>();
/** cor estável por categoria (faixa à esquerda do cartão), ajuda a localizar sem ler */
function catColor(id: string) {
  if (!catIndex.has(id)) catIndex.set(id, catIndex.size);
  return CAT_COLORS[catIndex.get(id)! % CAT_COLORS.length]!;
}

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

  const products = useMemo(() => (menu.data ?? []).flatMap((c) => c.products.map((p) => ({ ...p, catName: c.name }))), [menu.data]);
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

  if (menu.isLoading) return <Layout title="Venda"><Loading /></Layout>;
  if (menu.error) return <Layout title="Venda"><ErrorBox error={menu.error} retry={() => menu.refetch()} /></Layout>;

  const dayClosed = day.data && !day.data.day;
  const missing: string[] = [];
  if (!targetId) {
    if (type === 'table' && !table) missing.push('mesa');
    if (delivery && (!cust.name || !cust.phone || !cust.street || !cust.number || !cust.neighborhoodId)) missing.push('dados de entrega');
  }

  const inCart = new Map<string, number>();
  for (const l of cart) {
    const p = products.find((x) => x.variants.some((v) => v.id === l.variantId));
    if (p) inCart.set(p.id, (inCart.get(p.id) ?? 0) + l.quantity);
  }
  const itemsCount = cart.reduce((a, l) => a + l.quantity, 0);
  const canSend = cart.length > 0 && missing.length === 0 && !dayClosed;

  return (
    <Layout title={targetId && target.data ? `Adicionar à comanda #${target.data.number}` : 'Venda'} flush>
      {dayClosed && (
        <div style={{ padding: '12px 16px 0' }}>
          <Alert kind="warn" action={<a className="btn sm" href="/caixa">Abrir o dia</a>}>
            O dia operacional está fechado. Abra o dia para registrar pedidos.
          </Alert>
        </div>
      )}
      <div className="pos">
        <section className="pos-catalog" aria-label="Produtos">
          <div className="pos-toolbar">
            <div className="input-icon">
              <Search className="icon" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                placeholder="Buscar por nome ou código"
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
              {!search && <kbd>F2</kbd>}
            </div>
            <div className="chips scroll" role="group" aria-label="Categorias">
              <button type="button" className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
                Todos <span className="count">{products.length}</span>
              </button>
              {menu.data!.map((c) => (
                <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: catColor(c.id) }} />
                  {c.name} <span className="count">{c.products.length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="pos-grid">
            {visible.length === 0 && (
              <Empty icon={SearchX} title="Nenhum produto encontrado">
                {term ? <span>Confira a grafia ou busque pelo código.</span> : null}
              </Empty>
            )}
            {visible.map((p) => {
              const off = !p.available || p.variants.every((v) => !v.available);
              const min = Math.min(...p.variants.map((v) => v.priceCents));
              const qty = inCart.get(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={'prod' + (off ? ' off' : '')}
                  style={{ ['--cat' as string]: catColor(p.categoryId) }}
                  onClick={() => add(p)}
                  aria-label={`${p.name}, ${formatBRL(min)}${off ? ', indisponível' : ''}${qty ? `, ${qty} no pedido` : ''}`}
                >
                  {qty ? <span className="in-cart" aria-hidden>{qty}</span> : null}
                  <span className="name" style={qty ? { paddingRight: 28 } : undefined}>{p.name}</span>
                  <span className="meta">
                    {p.code && <span className="code">{p.code}</span>}
                    <span className="ellipsis">{p.catName}</span>
                  </span>
                  <span className="price">
                    {off ? (
                      'Indisponível'
                    ) : (
                      <>
                        {p.variants.length > 1 && <small>a partir de</small>}
                        {formatBRL(min)}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="pos-mobile-bar">
            <span className="hstack" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0, flex: '0 0 auto' }}>
              <small className="muted">{itemsCount} {itemsCount === 1 ? 'item' : 'itens'}</small>
              <b className="money" style={{ fontSize: '1.15rem' }}>{formatBRL(preview.totalCents)}</b>
            </span>
            <Button variant="primary" icon={ShoppingCart} onClick={() => setShowCart(true)}>
              Ver pedido
            </Button>
          </div>
        </section>

        <section className={'pos-cart' + (showCart ? ' show' : '')} aria-label="Pedido atual">
          <div className="cart-head">
            <div className="cart-title">
              {showCart && <Button size="sm" variant="ghost" icon={ArrowLeft} aria-label="Voltar aos produtos" onClick={() => setShowCart(false)} />}
              <h2>{targetId ? `Comanda #${target.data?.number ?? '…'}` : 'Pedido'}</h2>
              {itemsCount > 0 && <span className="badge">{itemsCount} {itemsCount === 1 ? 'item' : 'itens'}</span>}
              <Button size="sm" variant="ghost" icon={Trash2} onClick={reset} disabled={!cart.length} title="Limpar pedido">
                Limpar
              </Button>
            </div>
            {targetId ? (
              <Alert kind="info" action={<button type="button" className="link-btn" onClick={() => setParams({})}>Novo pedido</button>}>
                Adicionando itens ao pedido #{target.data?.number ?? '…'} {target.data ? `(${target.data.place})` : ''}.
              </Alert>
            ) : (
              <>
                <div className="type-switch" role="group" aria-label="Tipo de pedido">
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
                {type === 'table' && (
                  <Field label="Mesa">
                    <select value={table} onChange={(e) => setTable(e.target.value)} aria-invalid={cart.length > 0 && !table ? true : undefined}>
                      <option value="">Selecione a mesa…</option>
                      {(settings.data?.tables ?? []).map((t: string) => (
                        <option key={t} value={t}>
                          Mesa {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            )}
          </div>
          <div className="cart-items">
            {cart.length === 0 && (
              <div className="cart-empty">
                <ShoppingCart className="icon" aria-hidden />
                <b style={{ color: 'var(--ink-2)' }}>Nenhum item ainda</b>
                <span>Toque nos produtos ou digite o código e Enter.</span>
                <span className="keys">
                  <span><kbd>F2</kbd> buscar</span>
                  <span><kbd>F4</kbd> enviar</span>
                  <span><kbd>F9</kbd> enviar e cobrar</span>
                </span>
              </div>
            )}
            {cart.map((l) => (
              <div key={l.key} className="cart-item">
                <div className="qty">
                  <button type="button" aria-label={`Menos ${l.productName}`} onClick={() => setCart((c) => c.flatMap((x) => (x.key === l.key ? (x.quantity > 1 ? [{ ...x, quantity: x.quantity - 1 }] : []) : [x])))}>
                    {l.quantity > 1 ? <Minus size={16} aria-hidden /> : <Trash2 size={15} aria-hidden />}
                  </button>
                  <b>{l.quantity}</b>
                  <button type="button" aria-label={`Mais ${l.productName}`} onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x)))}>
                    <Plus size={16} aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  className="linkish"
                  aria-label={`Editar ${l.productName}`}
                  onClick={() => {
                    const p = products.find((x) => x.variants.some((v) => v.id === l.variantId));
                    if (p) setPicking({ product: p, line: l });
                  }}
                >
                  <span className="item-name">
                    {l.productName}
                    {l.variantName ? ` (${l.variantName})` : ''}
                  </span>
                  {l.options.length > 0 && <div className="opts">{l.options.map((o) => (o.quantity > 1 ? `${o.quantity}x ` : '') + o.name).join(', ')}</div>}
                  {l.notes && <div className="note">“{l.notes}”</div>}
                  <span className="edit-hint">
                    <Pencil size={12} aria-hidden /> editar
                  </span>
                </button>
                <span className="money right">{formatBRL(lineTotal(l))}</span>
              </div>
            ))}
            {!targetId && (
              <details className="cart-extra" open={delivery || undefined}>
                <summary>
                  {delivery ? <MapPin size={18} aria-hidden /> : <UserRound size={18} aria-hidden />}
                  {delivery ? 'Cliente e endereço de entrega' : 'Cliente e observação'}
                  {!delivery && <small className="muted">(opcional)</small>}
                  <ChevronDown className="chev" size={18} aria-hidden />
                </summary>
                <div className="cart-extra-body">
                  <CustomerFields value={cust} onChange={setCust} delivery={delivery} onRepeat={(id, n) => void repeatOrder(id, n)} />
                  <Field label="Observação do pedido">
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Ex.: cliente aguarda no balcão" />
                  </Field>
                </div>
              </details>
            )}
          </div>
          <div className="cart-foot">
            <div className="totals">
              <span className="sub">Itens</span>
              <span className="sub">{formatBRL(preview.subtotalCents)}</span>
              {delivery && !targetId && (
                <>
                  <span className="sub">Taxa de entrega {nb ? `· ${nb.name}` : ''}</span>
                  <span className="sub">{nb ? formatBRL(preview.deliveryFeeCents) : '—'}</span>
                </>
              )}
              <span className="grand">Total</span>
              <span className="grand">{formatBRL(preview.totalCents)}</span>
            </div>
            {missing.length > 0 && cart.length > 0 && (
              <Alert kind="warn">
                Para enviar, informe: <b>{missing.join(', ')}</b>.
              </Alert>
            )}
            <div className="cart-actions" style={targetId ? { gridTemplateColumns: '1fr' } : undefined}>
              <Button variant="primary" size="lg" busy={busy} disabled={!canSend} onClick={() => void submit(false)} kbd="F4">
                {targetId ? 'Adicionar e enviar' : 'Enviar pedido'}
              </Button>
              {!targetId && (
                <Button variant="success" size="lg" busy={busy} disabled={!canSend} onClick={() => void submit(true)} kbd="F9">
                  Enviar e cobrar
                </Button>
              )}
            </div>
            <small className="muted" style={{ textAlign: 'center' }}>
              Valores conferidos pelo servidor ao enviar. Descontos são aplicados no pedido.
            </small>
          </div>
        </section>
      </div>

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
          title={`Pedido #${created.order.number} registrado`}
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
            <p style={{ fontSize: '2.6rem', fontWeight: 800, margin: '4px 0 0', letterSpacing: '-.02em' }}>#{created.order.number}</p>
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
            if (o.balanceCents <= 0) {
              setCreated(null);
              ui.toast(`Pedido #${o.number} quitado`, 'ok');
            } else setCreated({ order: o, pay: true });
          }}
        />
      )}
      {drawer && <OrderDrawer orderId={drawer} onClose={() => setDrawer(null)} />}
    </Layout>
  );
}
