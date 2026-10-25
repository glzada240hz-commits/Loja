import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { computeOrderTotals, formatBRL, ORDER_TYPE_LABEL, type OrderType } from '@guto/core';
import { Layout } from '../components/Layout';
import { CustomerFields, customerPayload, emptyCustomer, type CustomerDraft } from '../components/CustomerFields';
import { lineToItemInput, lineTotal, ProductDialog } from '../components/ProductDialog';
import { OrderDrawer } from '../components/OrderDrawer';
import { PaymentDialog } from '../components/PaymentDialog';
import { Button, Empty, ErrorBox, Field, Loading, Modal, useAction, useUi } from '../components/ui';
import { ApiError, newIdemKey, post } from '../lib/api';
import { useDay, useMenu, useNeighborhoods, useOrder, useSettings } from '../lib/queries';
import type { CartLine, MenuProduct, Order } from '../lib/types';

const TYPES: OrderType[] = ['counter', 'takeout', 'delivery', 'table'];

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const products = useMemo(() => (menu.data ?? []).flatMap((c) => c.products.map((p) => ({ ...p, catName: c.name }))), [menu.data]);
  const term = search.trim().toLowerCase();
  const visible = products.filter((p) => (cat === 'all' || p.categoryId === cat) && (!term || p.name.toLowerCase().includes(term) || p.code === term));

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

  return (
    <Layout title={targetId && target.data ? `Adicionar à comanda #${target.data.number}` : 'Venda'} flush>
      {dayClosed && (
        <div className="alert warn" style={{ margin: 12 }}>
          O dia operacional está fechado. <a href="/caixa">Abra o dia</a> para registrar pedidos.
        </div>
      )}
      <div className="pos">
        <section className="pos-catalog" aria-label="Produtos">
          <div className="pos-search">
            <input
              ref={searchRef}
              type="search"
              placeholder="Buscar produto ou código (F2)"
              value={search}
              aria-label="Buscar produto"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && visible.length === 1) {
                  add(visible[0]!);
                  setSearch('');
                }
                if (e.key === 'Escape') setSearch('');
              }}
            />
          </div>
          <div className="pos-cats">
            <div className="chips">
              <button type="button" className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
                Todos
              </button>
              {menu.data!.map((c) => (
                <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="pos-grid">
            {visible.length === 0 && <Empty title="Nenhum produto encontrado" />}
            {visible.map((p) => {
              const off = !p.available || p.variants.every((v) => !v.available);
              const min = Math.min(...p.variants.map((v) => v.priceCents));
              return (
                <button key={p.id} type="button" className={'prod' + (off ? ' off' : '')} onClick={() => add(p)} aria-label={`${p.name}, ${formatBRL(min)}${off ? ', indisponível' : ''}`}>
                  {p.code && <span className="code">{p.code}</span>}
                  <span className="name">{p.name}</span>
                  <small className="muted">{p.catName}</small>
                  <span className="price">
                    {p.variants.length > 1 ? 'a partir de ' : ''}
                    {formatBRL(min)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="pos-mobile-bar">
            <span>
              {cart.reduce((a, l) => a + l.quantity, 0)} itens · <b>{formatBRL(preview.totalCents)}</b>
            </span>
            <span className="spacer" />
            <Button variant="primary" onClick={() => setShowCart(true)}>
              Ver pedido
            </Button>
          </div>
        </section>

        <section className={'pos-cart' + (showCart ? ' show' : '')} aria-label="Pedido atual">
          <div className="cart-head">
            {showCart && (
              <Button size="sm" variant="ghost" onClick={() => setShowCart(false)} style={{ marginBottom: 6 }}>
                ← Voltar aos produtos
              </Button>
            )}
            {targetId ? (
              <div className="alert info" style={{ margin: 0 }}>
                Adicionando itens ao pedido #{target.data?.number ?? '…'}.{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setParams({});
                  }}
                >
                  Novo pedido
                </a>
              </div>
            ) : (
              <>
                <div className="type-switch" role="group" aria-label="Tipo de pedido">
                  {TYPES.map((t) => (
                    <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
                      {ORDER_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
                {type === 'table' && (
                  <Field label="Mesa">
                    <select value={table} onChange={(e) => setTable(e.target.value)}>
                      <option value="">Selecione…</option>
                      {(settings.data?.tables ?? []).map((t: string) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            )}
          </div>
          <div className="cart-items">
            {cart.length === 0 && <Empty title="Pedido vazio">Toque nos produtos para adicionar.</Empty>}
            {cart.map((l) => (
              <div key={l.key} className="cart-item">
                <div className="qty">
                  <button type="button" aria-label={`Menos ${l.productName}`} onClick={() => setCart((c) => c.flatMap((x) => (x.key === l.key ? (x.quantity > 1 ? [{ ...x, quantity: x.quantity - 1 }] : []) : [x])))}>
                    −
                  </button>
                  <b className="num" style={{ minWidth: 20, textAlign: 'center' }}>
                    {l.quantity}
                  </b>
                  <button type="button" aria-label={`Mais ${l.productName}`} onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x)))}>
                    +
                  </button>
                </div>
                <button
                  type="button"
                  style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, font: 'inherit', cursor: 'pointer', color: 'inherit' }}
                  onClick={() => {
                    const p = products.find((x) => x.variants.some((v) => v.id === l.variantId));
                    if (p) setPicking({ product: p, line: l });
                  }}
                >
                  <b>
                    {l.productName}
                    {l.variantName ? ` (${l.variantName})` : ''}
                  </b>
                  {l.options.length > 0 && <div className="opts">{l.options.map((o) => (o.quantity > 1 ? `${o.quantity}x ` : '') + o.name).join(', ')}</div>}
                  {l.notes && <div className="note">“{l.notes}”</div>}
                  <small className="muted">toque para editar</small>
                </button>
                <span className="num right">{formatBRL(lineTotal(l))}</span>
              </div>
            ))}
            {!targetId && (
              <details style={{ marginTop: 10 }} open={delivery || undefined}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 36 }}>{delivery ? 'Cliente e entrega' : 'Cliente e observações (opcional)'}</summary>
                <CustomerFields value={cust} onChange={setCust} delivery={delivery} />
                <Field label="Observação do pedido">
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
                </Field>
              </details>
            )}
          </div>
          <div className="cart-foot">
            <div className="totals" style={{ marginBottom: 8 }}>
              <span>Itens</span>
              <span>{formatBRL(preview.subtotalCents)}</span>
              {delivery && !targetId && (
                <>
                  <span>Taxa de entrega {nb ? `(${nb.name})` : ''}</span>
                  <span>{formatBRL(preview.deliveryFeeCents)}</span>
                </>
              )}
              <span className="grand">Total</span>
              <span className="grand">{formatBRL(preview.totalCents)}</span>
            </div>
            <small className="muted" style={{ display: 'block', marginBottom: 6 }}>
              Prévia. O total oficial é calculado pelo servidor; descontos são aplicados no pedido.
            </small>
            {missing.length > 0 && cart.length > 0 && <div className="alert warn">Falta: {missing.join(', ')}</div>}
            <div className="hstack">
              <Button onClick={reset} disabled={!cart.length}>
                Limpar
              </Button>
              <Button variant="dark" size="lg" style={{ flex: 1 }} busy={busy} disabled={!cart.length || missing.length > 0 || !!dayClosed} onClick={() => void submit(false)}>
                {targetId ? 'Adicionar e enviar' : 'Enviar pedido (F4)'}
              </Button>
              {!targetId && (
                <Button variant="success" size="lg" busy={busy} disabled={!cart.length || missing.length > 0 || !!dayClosed} onClick={() => void submit(true)}>
                  Enviar e cobrar
                </Button>
              )}
            </div>
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
                Imprimir comanda
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
          <p className="big" style={{ fontSize: '2.4rem', fontWeight: 800, textAlign: 'center', margin: 0 }}>
            #{created.order.number}
          </p>
          <p style={{ textAlign: 'center' }}>
            Total {formatBRL(created.order.totalCents)} · {created.order.tickets.length ? 'enviado à cozinha' : 'sem itens de cozinha'}
          </p>
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
