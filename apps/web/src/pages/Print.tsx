import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { formatBRL, formatPhoneBR, ORDER_TYPE_LABEL, PAYMENT_METHOD_LABEL } from '@guto/core';
import { Button, ErrorBox, Loading } from '../components/ui';
import { formatDateTime, formatTime } from '../lib/format';
import { useOrder, useSettings } from '../lib/queries';

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
  useEffect(() => {
    if (q.data && s.data && p.get('auto') === '1') setTimeout(() => window.print(), 300);
  }, [q.data, s.data, p]);
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
        <Button onClick={() => set('via', via === 'cliente' ? 'cozinha' : 'cliente')}>Via: {via === 'cliente' ? 'cliente' : 'cozinha'}</Button>
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
          <>
            <h1>{s.data.storeName}</h1>
            {s.data.storeAddress && <div className="c">{s.data.storeAddress}</div>}
            {s.data.storePhone && <div className="c">{s.data.storePhone}</div>}
            <div className="warn">NÃO É DOCUMENTO FISCAL</div>
            <div className="l"><span>Pedido</span><b>#{o.number}</b></div>
            <div className="l"><span>{o.type === 'table' ? `Mesa ${o.tableLabel}` : ORDER_TYPE_LABEL[o.type]}</span><span>{formatDateTime(o.createdAt)}</span></div>
            {o.createdByName && <div>Atendente: {o.createdByName}</div>}
            {o.customerName && <div>Cliente: {o.customerName}</div>}
            {o.customerPhone && <div>Tel: {formatPhoneBR(o.customerPhone)}</div>}
            {o.type === 'delivery' && (
              <div>
                {o.addrStreet}, {o.addrNumber}{o.addrComplement ? ` - ${o.addrComplement}` : ''}<br />{o.neighborhoodName}{o.addrReference ? ` · Ref: ${o.addrReference}` : ''}
              </div>
            )}
            <hr />
            {items.map((i) => (
              <div key={i.id}>
                <div className="l"><span>{i.quantity}x {i.productName}{i.variantName ? ` (${i.variantName})` : ''}</span><span>{formatBRL(i.totalCents)}</span></div>
                {i.options.map((x) => <div key={x.id} style={{ paddingLeft: 8 }}>{x.optionName}{x.priceCents ? ` +${formatBRL(x.priceCents * x.quantity)}` : ''}</div>)}
                {i.notes && <div style={{ paddingLeft: 8 }}>obs: {i.notes}</div>}
              </div>
            ))}
            <hr />
            <div className="l"><span>Itens</span><span>{formatBRL(o.subtotalCents)}</span></div>
            {o.discountCents > 0 && <div className="l"><span>Desconto</span><span>-{formatBRL(o.discountCents)}</span></div>}
            {o.type === 'delivery' && <div className="l"><span>Taxa de entrega</span><span>{formatBRL(o.deliveryFeeCents)}</span></div>}
            <div className="l" style={{ fontSize: 15 }}><b>TOTAL</b><b>{formatBRL(o.totalCents)}</b></div>
            {o.payments.filter((x) => x.status === 'confirmed').map((x) => (
              <div key={x.id} className="l"><span>{PAYMENT_METHOD_LABEL[x.method]}{x.changeCents ? ` (troco ${formatBRL(x.changeCents)})` : ''}</span><span>{formatBRL(x.amountCents)}</span></div>
            ))}
            {o.balanceCents > 0 && (
              <div className="l"><b>A PAGAR</b><b>{formatBRL(o.balanceCents)}</b></div>
            )}
            {o.balanceCents > 0 && o.paymentIntent && <div>Pagamento na entrega: {PAYMENT_METHOD_LABEL[o.paymentIntent]}{o.changeForCents ? ` · troco p/ ${formatBRL(o.changeForCents)}` : ''}</div>}
            {o.notes && <div>Obs: {o.notes}</div>}
            <hr />
            <div className="c">{s.data.receiptFooter}</div>
            <div className="c" style={{ fontSize: 10 }}>ID {o.id.slice(0, 8)}</div>
          </>
        )}
      </div>
    </div>
  );
}
