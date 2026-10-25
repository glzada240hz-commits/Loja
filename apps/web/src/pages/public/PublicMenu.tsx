import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { computeOrderTotals, formatBRL, normalizePhoneBR, PAYMENT_METHOD_LABEL, type PaymentMethod } from '@guto/core';
import { Logo } from '../../components/Logo';
import { lineToItemInput, lineTotal, ProductDialog } from '../../components/ProductDialog';
import { Button, Chips, Empty, ErrorBox, Field, Loading, Modal, MoneyInput, Stepper } from '../../components/ui';
import { ApiError, get, newIdemKey, post } from '../../lib/api';
import type { CartLine, MenuCategory, MenuProduct } from '../../lib/types';

interface PublicData {
  store: { name: string; phone: string; address: string; open: boolean; closedReason: string | null; minOrderCents: number; pickupEtaMinutes: number; deliveryEtaMinutes: number; paymentMethods: PaymentMethod[]; pixKeyDisplay: string };
  menu: MenuCategory[];
  neighborhoods: { id: string; name: string; feeCents: number; minOrderCents: number; etaMinutes: number }[];
}

const CART_KEY = 'guto-cart-v1';
function loadCart(): CartLine[] {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export default function PublicMenu() {
  const q = useQuery({ queryKey: ['public-menu'], queryFn: () => get<PublicData>('/api/public/menu'), refetchInterval: 120000 });
  const [cart, setCart] = useState<CartLine[]>(loadCart);
  const [picking, setPicking] = useState<MenuProduct | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [cat, setCat] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* armazenamento indisponível */
    }
  }, [cart]);
  useEffect(() => {
    document.title = 'Cardápio — Bar do Guto';
  }, []);

  // remove do carrinho itens que deixaram de existir no cardápio
  const validVariants = useMemo(() => new Set(q.data?.menu.flatMap((c) => c.products.flatMap((p) => p.variants.filter((v) => v.available && p.available).map((v) => v.id))) ?? []), [q.data]);
  const visibleCart = q.data ? cart.filter((l) => validVariants.has(l.variantId)) : cart;
  const removed = cart.length - visibleCart.length;

  if (q.isLoading) return <div className="public"><Loading /></div>;
  if (q.error) return <div className="public" style={{ padding: 16 }}><ErrorBox error={q.error} retry={() => q.refetch()} /></div>;
  const { store, menu } = q.data!;
  const subtotal = visibleCart.reduce((a, l) => a + lineTotal(l), 0);
  const count = visibleCart.reduce((a, l) => a + l.quantity, 0);

  return (
    <div className="public">
      <header className="public-hero">
        <h1><Logo size={40} /> {store.name}</h1>
        <p style={{ margin: '6px 0 0', color: '#e9e0d3' }}>
          {store.open ? <span className="badge green">Aberto para pedidos</span> : <span className="badge red">{store.closedReason}</span>}{' '}
          Retirada ~{store.pickupEtaMinutes} min · Entrega ~{store.deliveryEtaMinutes} min
        </p>
      </header>
      <nav className="public-cats" aria-label="Categorias">
        <div className="chips">
          {menu.map((c) => (
            <a key={c.id} className="chip" aria-pressed={cat === c.id} href={`#cat-${c.id}`} onClick={() => setCat(c.id)} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
              {c.name}
            </a>
          ))}
        </div>
      </nav>
      <main style={{ padding: 12 }}>
        {removed > 0 && <div className="alert warn">{removed} item(ns) do seu carrinho não estão mais disponíveis e foram retirados.</div>}
        {menu.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} style={{ marginBottom: 18, scrollMarginTop: 60 }}>
            <h2>{c.name}</h2>
            <div className="stack">
              {c.products.map((p) => {
                const off = !p.available || p.variants.every((v) => !v.available);
                const min = Math.min(...p.variants.map((v) => v.priceCents));
                return (
                  <button key={p.id} type="button" className={'menu-item' + (off ? ' off' : '')} disabled={off} onClick={() => setPicking(p)}>
                    <div>
                      <b>{p.name}</b>
                      {p.description && <div className="desc">{p.description}</div>}
                      <div style={{ marginTop: 6, fontWeight: 800 }}>
                        {off ? <span className="badge red">Indisponível</span> : <>{p.variants.length > 1 ? 'a partir de ' : ''}{formatBRL(min)}</>}
                      </div>
                    </div>
                    {p.imagePath ? <img src={p.imagePath} alt="" loading="lazy" /> : <span />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        <p className="muted" style={{ textAlign: 'center', fontSize: '.85rem' }}>
          Preços e disponibilidade são conferidos novamente ao confirmar o pedido. {store.phone && <>Dúvidas: {store.phone}</>}
        </p>
      </main>
      {count > 0 && (
        <div className="cart-bar">
          <Button variant="dark" size="lg" block onClick={() => setCheckout(true)}>
            Ver carrinho · {count} item(ns) · {formatBRL(subtotal)}
          </Button>
        </div>
      )}
      {picking && (
        <ProductDialog
          product={picking}
          publicView
          onClose={() => setPicking(null)}
          onConfirm={(l) => {
            setCart((c) => [...c, l]);
            setPicking(null);
          }}
        />
      )}
      {checkout && <Checkout data={q.data!} cart={visibleCart} setCart={setCart} onClose={() => setCheckout(false)} />}
    </div>
  );
}

function Checkout({ data, cart, setCart, onClose }: { data: PublicData; cart: CartLine[]; setCart: (c: CartLine[]) => void; onClose: () => void }) {
  const nav = useNavigate();
  const { store, neighborhoods } = data;
  const [type, setType] = useState<'delivery' | 'takeout'>('delivery');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [reference, setReference] = useState('');
  const [nbId, setNb] = useState('');
  const [notes, setNotes] = useState('');
  const [pay, setPay] = useState<PaymentMethod>(store.paymentMethods[0] ?? 'cash');
  const [changeFor, setChangeFor] = useState<number | null>(null);
  const [optIn, setOptIn] = useState(true);
  const [privacy, setPrivacy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdemKey());
  const nb = neighborhoods.find((n) => n.id === nbId);
  const totals = computeOrderTotals({ items: cart.map((l) => ({ unitPriceCents: l.unitPriceCents, quantity: l.quantity, options: l.options })), discount: null, deliveryFeeCents: type === 'delivery' && nb ? nb.feeCents : 0 });
  const minOrder = Math.max(store.minOrderCents, type === 'delivery' ? (nb?.minOrderCents ?? 0) : 0);
  const problems: string[] = [];
  if (!store.open) problems.push(store.closedReason ?? 'Loja fechada');
  if (name.trim().length < 2) problems.push('Informe seu nome');
  if (!normalizePhoneBR(phone)) problems.push('Informe um telefone válido com DDD');
  if (type === 'delivery' && (!street.trim() || !number.trim() || !nbId)) problems.push('Preencha o endereço e o bairro');
  if (totals.subtotalCents < minOrder) problems.push(`Pedido mínimo de ${formatBRL(minOrder)}`);
  if (pay === 'cash' && changeFor != null && changeFor < totals.totalCents) problems.push('O troco deve ser para um valor maior que o total');
  if (!privacy) problems.push('Aceite o uso dos seus dados para o pedido');

  const submit = async () => {
    if (busy || problems.length) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ number: number; trackingToken: string }>(
        '/api/public/orders',
        {
          type,
          customer: { name, phone },
          address: type === 'delivery' ? { street, number, complement: complement || null, reference: reference || null, neighborhoodId: nbId } : null,
          notes: notes || null,
          items: cart.map(lineToItemInput),
          paymentIntent: pay,
          changeForCents: pay === 'cash' ? changeFor : null,
          waOptIn: optIn,
          privacyAccepted: true,
        },
        { idempotencyKey: key.current },
      );
      setCart([]);
      nav(`/c/pedido/${r.trackingToken}`);
    } catch (e) {
      // erro de rede: mantém a mesma chave — reenviar não duplica o pedido
      setErr(e instanceof ApiError && e.code === 'network' ? 'Sem conexão. Seu pedido ainda NÃO foi confirmado. Tente enviar de novo.' : (e as Error).message);
      if (!(e instanceof ApiError && (e.code === 'network' || e.status >= 500))) key.current = newIdemKey();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title="Seu pedido"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Continuar comprando</Button>
          <Button variant="success" size="lg" busy={busy} disabled={problems.length > 0 || cart.length === 0} onClick={submit}>
            Confirmar pedido · {formatBRL(totals.totalCents)}
          </Button>
        </>
      }
    >
      {cart.length === 0 && <Empty title="Carrinho vazio" />}
      {cart.map((l) => (
        <div key={l.key} className="order-line">
          <div>
            <b>{l.productName}{l.variantName ? ` (${l.variantName})` : ''}</b>
            {l.options.length > 0 && <div><small className="muted">{l.options.map((o) => o.name).join(', ')}</small></div>}
            {l.notes && <div><small>“{l.notes}”</small></div>}
            <div style={{ marginTop: 4 }}>
              <Stepper label={l.productName} value={l.quantity} min={0} onChange={(v) => setCart(v === 0 ? cart.filter((x) => x.key !== l.key) : cart.map((x) => (x.key === l.key ? { ...x, quantity: v } : x)))} />
            </div>
          </div>
          <span className="num">{formatBRL(lineTotal(l))}</span>
        </div>
      ))}
      <div style={{ height: 12 }} />
      <Chips label="Entrega ou retirada" value={type} onChange={setType} options={[{ id: 'delivery', label: 'Entrega' }, { id: 'takeout', label: 'Retirar no local' }]} />
      <div style={{ height: 10 }} />
      <div className="row">
        <Field label="Seu nome"><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label="Telefone (WhatsApp)"><input autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98888-7777" /></Field>
      </div>
      {type === 'delivery' ? (
        <>
          <Field label="Bairro">
            <select value={nbId} onChange={(e) => setNb(e.target.value)}>
              <option value="">Selecione…</option>
              {neighborhoods.map((n) => <option key={n.id} value={n.id}>{n.name} — entrega {formatBRL(n.feeCents)}{n.minOrderCents ? ` · mín. ${formatBRL(n.minOrderCents)}` : ''}</option>)}
            </select>
          </Field>
          {!neighborhoods.length && <div className="alert warn">Nenhum bairro disponível para entrega no momento.</div>}
          <div className="row">
            <Field label="Rua"><input autoComplete="address-line1" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={150} /></Field>
            <Field label="Número"><input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={20} style={{ maxWidth: 110 }} /></Field>
          </div>
          <div className="row">
            <Field label="Complemento"><input value={complement} onChange={(e) => setComplement(e.target.value)} maxLength={100} /></Field>
            <Field label="Ponto de referência"><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={150} /></Field>
          </div>
        </>
      ) : (
        <div className="alert info">Retirada em: {store.address || 'endereço da loja'}</div>
      )}
      <Field label="Observações"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
      <Field label="Pagamento (na entrega/retirada)" group>
        <Chips label="Forma de pagamento" value={pay} onChange={setPay} options={store.paymentMethods.map((m) => ({ id: m, label: m === 'pix_manual' ? 'Pix' : PAYMENT_METHOD_LABEL[m] }))} />
      </Field>
      {pay === 'pix_manual' && <div className="alert info">{store.pixKeyDisplay ? `Chave Pix: ${store.pixKeyDisplay}. ` : ''}O pagamento é confirmado pela loja após conferir o recebimento — o envio de comprovante não confirma automaticamente.</div>}
      {pay === 'cash' && (
        <Field label="Troco para (opcional)"><MoneyInput value={changeFor} onChange={setChangeFor} /></Field>
      )}
      <div className="totals" style={{ margin: '10px 0' }}>
        <span>Itens</span><span>{formatBRL(totals.subtotalCents)}</span>
        {type === 'delivery' && (<><span>Entrega</span><span>{nb ? formatBRL(totals.deliveryFeeCents) : 'selecione o bairro'}</span></>)}
        <span className="grand">Total</span><span className="grand">{formatBRL(totals.totalCents)}</span>
      </div>
      <label className="check"><input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /> Quero receber atualizações deste pedido pelo WhatsApp</label>
      <label className="check" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
        <span>Concordo com o uso do meu nome, telefone e endereço para preparar, entregar e me informar sobre este pedido. Posso pedir a exclusão dos meus dados à loja.</span>
      </label>
      {err && <div className="alert error" role="alert">{err}</div>}
      {problems.length > 0 && cart.length > 0 && <small className="muted">Para confirmar: {problems.join(' · ')}</small>}
    </Modal>
  );
}
