import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { buildPixPayload, formatBRL, formatPhoneBR, ORDER_TYPE_LABEL, PAYMENT_METHOD_LABEL } from '@guto/core';
import { Button, ErrorBox, Loading } from '../components/ui';
import { formatDateTime, formatTime } from '../lib/format';
import { useOrder, useSettings } from '../lib/queries';
import type { Order } from '../lib/types';
import { formatPlan } from '../components/PaymentPlan';

/**
 * Impressão pelo navegador (diálogo do sistema) em bobina de 58 ou 80 mm.
 * Impressão direta em impressora térmica (ESC/POS) exigiria um agente local — não incluído/validado.
 */
export default function Print() {
  const { id } = useParams();
  const [p, setP] = useSearchParams();
  const via = p.get('via') === 'cozinha' ? 'cozinha' : 'cliente';
  const w = p.get('w') === '58' ? '58' : '80';
  const q = useOrder(id);
  const s = useSettings();
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@page { size: ${w}mm auto; margin: 0; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [w]);
  const o0 = q.data;
  const st = s.data;
  /** QR Pix com o valor que falta (só na conta em aberto e com chave cadastrada) */
  const pix = useMemo(() => {
    if (!o0 || !st?.pixKey || o0.balanceCents <= 0 || via !== 'cliente') return null;
    try {
      return buildPixPayload({ key: st.pixKey, name: st.storeName, city: st.pixCity || 'BRASIL', amountCents: o0.balanceCents, txid: `PED${o0.number}` });
    } catch {
      return null;
    }
  }, [o0, st, via]);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setQr(null);
    if (pix) void import('qrcode').then((m) => m.toString(pix, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })).then((svg) => alive && setQr(svg));
    return () => {
      alive = false;
    };
  }, [pix]);
  const logo: string | null = st ? st.logoUrl || '/logo-nota.png' : null;
  const [logoOk, setLogoOk] = useState(false);
  useEffect(() => {
    setLogoOk(false);
    if (!logo) return;
    const img = new Image();
    img.onload = img.onerror = () => setLogoOk(true);
    img.src = logo;
  }, [logo]);
  const qrReady = (!pix || qr !== null) && (!logo || logoOk);
  useEffect(() => {
    if (!(q.data && s.data && qrReady && p.get('auto') === '1')) return;
    // janela aberta pelo sistema: fecha sozinha depois de imprimir (ou cancelar)
    const after = () => setTimeout(() => window.close(), 200);
    window.addEventListener('afterprint', after);
    const t = setTimeout(() => window.print(), 300);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', after);
    };
  }, [q.data, s.data, p, qrReady]);
  if (q.isLoading || s.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const o = q.data;
  const items = o.items.filter((i) => i.status === 'active');
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(p);
    n.set(k, v);
    setP(n, { replace: true });
  };
  return (
    <div style={{ background: '#e9e4dc', minHeight: '100%' }}>
      <div className="print-toolbar no-print">
        <Button variant="primary" onClick={() => window.print()}>Imprimir</Button>
        <Button onClick={() => set('via', via === 'cliente' ? 'cozinha' : 'cliente')}>{via === 'cliente' ? 'Nota do cliente' : 'Via da cozinha'} · trocar</Button>
        <Button onClick={() => set('w', w === '80' ? '58' : '80')}>Bobina: {w} mm</Button>
        <small className="muted" style={{ alignSelf: 'center' }}>Impressão pelo navegador. Ajuste margens para “nenhuma” no diálogo de impressão.</small>
      </div>
      <div className={`print-root w${w}`} style={{ marginTop: 10 }}>
        {via === 'cozinha' ? (
          <>
            <div className="c">COZINHA</div>
            <div className="big">#{o.number}</div>
            <div className="c"><b>{o.type === 'table' ? `MESA ${o.tableLabel}` : ORDER_TYPE_LABEL[o.type].toUpperCase()}</b></div>
            <div className="c">{formatDateTime(o.createdAt)}</div>
            {o.customerName && <div className="c">{o.customerName}</div>}
            <hr />
            {items.filter((i) => i.sendToKitchen).map((i) => (
              <div key={i.id} style={{ marginBottom: 4 }}>
                <b>{i.quantity}x {i.productName}{i.variantName ? ` (${i.variantName})` : ''}</b>
                {i.options.map((x) => <div key={x.id}>  {/^sem /i.test(x.optionName) ? x.optionName.toUpperCase() : `+ ${x.quantity > 1 ? x.quantity + 'x ' : ''}${x.optionName}`}</div>)}
                {i.notes && <div>  OBS: {i.notes}</div>}
              </div>
            ))}
            {o.notes && <><hr /><div>OBS DO PEDIDO: {o.notes}</div></>}
            {o.etaAt && <div className="c">Previsão {formatTime(o.etaAt)}</div>}
          </>
        ) : (
          <Nota o={o} items={items} st={s.data} qr={qr} pix={pix} />
        )}
      </div>
    </div>
  );
}

/**
 * Nota NÃO fiscal do cliente. Com saldo: "CONTA" para conferência (e QR Pix com o valor, se a loja cadastrou a
 * chave). Quitada: "NOTA DE VENDA — PAGO" com as formas de pagamento e o troco.
 */
function Nota({ o, items, st, qr, pix }: { o: Order; items: Order['items']; st: any; qr: string | null; pix: string | null }) {
  const paid = o.balanceCents <= 0 && o.totalCents > 0;
  const pays = o.payments.filter((x) => x.status === 'confirmed');
  const change = pays.reduce((a, x) => a + (x.changeCents ?? 0), 0);
  const lastPay = pays.length ? pays[pays.length - 1]! : null;
  return (
    <>
      <img className={'nota-logo' + (st.logoUrl ? ' enviada' : '')} src={st.logoUrl || '/logo-nota.png'} alt="" />
      <h1>{st.storeName}</h1>
      {st.storeDocument && <div className="c">{st.storeDocument}</div>}
      {st.storeAddress && <div className="c">{st.storeAddress}</div>}
      {st.storePhone && <div className="c">{st.storePhone}</div>}
      <div className="warn">{paid ? 'NOTA DE VENDA — PAGO' : 'CONTA — CONFERÊNCIA'}<br />NÃO É DOCUMENTO FISCAL</div>
      <div className="l"><span>Pedido</span><b>#{o.number}</b></div>
      <div className="l"><span>{o.type === 'table' ? (o.tabKind === 'tab' ? `Comanda ${o.tableLabel}` : `Mesa ${o.tableLabel}`) : ORDER_TYPE_LABEL[o.type]}</span><span>{formatDateTime(o.createdAt)}</span></div>
      {o.createdByName && <div>Atendente: {o.createdByName}</div>}
      {o.customerName && <div>Cliente: {o.customerName}</div>}
      {o.customerPhone && <div>Tel: {formatPhoneBR(o.customerPhone)}</div>}
      {o.type === 'delivery' && (
        <div>
          {o.addrStreet}, {o.addrNumber}{o.addrComplement ? ` - ${o.addrComplement}` : ''}<br />{o.neighborhoodName}{o.addrReference ? ` · Ref: ${o.addrReference}` : ''}
        </div>
      )}
      <hr />
      <div className="l"><b>Item</b><b>Total</b></div>
      {items.map((i) => (
        <div key={i.id} className="item">
          <div>{i.productName}{i.variantName ? ` (${i.variantName})` : ''}</div>
          {i.options.map((x) => <div key={x.id} className="sub">{x.quantity > 1 ? `${x.quantity}x ` : ''}{x.optionName}{x.priceCents ? ` +${formatBRL(x.priceCents * x.quantity)}` : ''}</div>)}
          {i.notes && <div className="sub">obs: {i.notes}</div>}
          <div className="l sub"><span>{i.quantity} x {formatBRL(i.unitPriceCents + i.optionsUnitCents)}</span><span>{formatBRL(i.totalCents)}</span></div>
        </div>
      ))}
      <hr />
      <div className="l"><span>Itens ({items.reduce((a, i) => a + i.quantity, 0)})</span><span>{formatBRL(o.subtotalCents)}</span></div>
      {o.discountCents > 0 && <div className="l"><span>Desconto</span><span>-{formatBRL(o.discountCents)}</span></div>}
      {o.type === 'delivery' && <div className="l"><span>Taxa de entrega</span><span>{formatBRL(o.deliveryFeeCents)}</span></div>}
      <div className="l total"><b>TOTAL</b><b>{formatBRL(o.totalCents)}</b></div>
      {pays.length > 0 && <hr />}
      {pays.map((x) => (
        <div key={x.id} className="l">
          <span>{PAYMENT_METHOD_LABEL[x.method]}{x.payerLabel ? ` · ${x.payerLabel}` : ''}</span>
          <span>{formatBRL(x.amountCents)}</span>
        </div>
      ))}
      {pays.some((x) => x.tenderedCents) && <div className="l"><span>Recebido em dinheiro</span><span>{formatBRL(pays.reduce((a, x) => a + (x.tenderedCents ?? 0), 0))}</span></div>}
      {change > 0 && <div className="l"><span>Troco</span><span>{formatBRL(change)}</span></div>}
      {o.balanceCents > 0 && <div className="l total"><b>A PAGAR</b><b>{formatBRL(o.balanceCents)}</b></div>}
      {o.balanceCents > 0 && o.paymentPlan?.length ? (
        <div>Pagamento combinado: {formatPlan(o.paymentPlan)}{o.changeForCents ? ` · troco p/ ${formatBRL(o.changeForCents)}` : ''}</div>
      ) : o.balanceCents > 0 && o.paymentIntent ? (
        <div>Pagamento na entrega: {PAYMENT_METHOD_LABEL[o.paymentIntent]}{o.changeForCents ? ` · troco p/ ${formatBRL(o.changeForCents)}` : ''}</div>
      ) : null}
      {pix && (
        <div className="pix">
          <hr />
          <div className="c"><b>Pague com Pix: {formatBRL(o.balanceCents)}</b></div>
          {qr ? <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} /> : <div className="c">gerando QR…</div>}
          <div className="c sub">Chave: {st.pixKey}</div>
          <div className="c sub">Mostre o comprovante ao caixa. O pagamento só vale depois da conferência.</div>
        </div>
      )}
      {o.notes && <div>Obs: {o.notes}</div>}
      <hr />
      {paid && lastPay && <div className="c sub">Pago em {formatDateTime(lastPay.createdAt)}{lastPay.userName ? ` · ${lastPay.userName}` : ''}</div>}
      <div className="c">{st.receiptFooter}</div>
      <div className="c" style={{ fontSize: 10 }}>Impresso em {formatDateTime(new Date().toISOString())} · ID {o.id.slice(0, 8)}</div>
    </>
  );
}
