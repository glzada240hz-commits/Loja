import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatBRL, PAYMENT_METHOD_LABEL } from '@guto/core';
import { Logo } from '../../components/Logo';
import { ErrorBox, Loading } from '../../components/ui';
import { get } from '../../lib/api';
import { formatTime } from '../../lib/format';

/** Acompanhamento do pedido pelo cliente: acesso só pelo código secreto do link; não expõe dados de outros pedidos. */
export default function Track() {
  const { token } = useParams();
  const q = useQuery({ queryKey: ['track', token], queryFn: () => get<any>(`/api/public/orders/${token}`), refetchInterval: 15000 });
  useEffect(() => {
    document.title = 'Acompanhe seu pedido — Bar do Guto';
  }, []);
  if (q.isLoading) return <div className="public"><Loading /></div>;
  if (q.error) return <div className="public" style={{ padding: 16 }}><ErrorBox error={q.error} /><Link to="/c">Voltar ao cardápio</Link></div>;
  const o = q.data;
  const delivery = o.type === 'delivery';
  const steps = [
    { key: 'received', label: o.status === 'pending' ? 'Aguardando confirmação da loja' : 'Confirmado pela loja', at: o.acceptedAt ?? o.createdAt, done: o.status !== 'pending' },
    { key: 'preparing', label: 'Em preparo', done: ['preparing', 'ready', 'out_for_delivery', 'delivered'].includes(o.stage) && o.status !== 'pending' },
    { key: 'ready', label: delivery ? 'Pronto' : 'Pronto para retirada', at: o.readyAt, done: ['ready', 'out_for_delivery', 'delivered'].includes(o.stage) },
    ...(delivery ? [{ key: 'out', label: 'Saiu para entrega', at: o.dispatchedAt, done: ['out_for_delivery', 'delivered'].includes(o.stage) }] : []),
    { key: 'done', label: delivery ? 'Entregue' : 'Retirado', at: o.deliveredAt, done: o.stage === 'delivered' },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="public">
      <header className="public-hero">
        <h1><Logo size={40} /> Pedido #{o.number}</h1>
        <p style={{ margin: '6px 0 0', color: '#e9e0d3' }}>
          {o.customerFirstName ? `Olá, ${o.customerFirstName}! ` : ''}Atualiza automaticamente.
        </p>
      </header>
      <main style={{ padding: 12 }}>
        {o.status === 'cancelled' ? (
          <div className="alert error">Este pedido foi cancelado. Em caso de dúvida, fale com a loja{o.store.phone ? `: ${o.store.phone}` : ''}.</div>
        ) : (
          <section className="card">
            {o.status === 'pending' && <div className="alert warn">Seu pedido foi recebido e ainda será CONFIRMADO pela loja.</div>}
            {o.etaAt && o.status !== 'pending' && o.stage !== 'delivered' && <p>Previsão: <b>{formatTime(o.etaAt)}</b></p>}
            <ol className="track-steps">
              {steps.map((s, i) => (
                <li key={s.key} className={s.done ? 'done' : i === current ? 'current' : ''}>
                  <span className="dot">{s.done ? '✓' : i + 1}</span>
                  <span>{s.label}{s.done && s.at ? <small className="muted"> · {formatTime(s.at)}</small> : null}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <section className="card">
          <h2>Resumo</h2>
          {o.items.map((i: any, idx: number) => (
            <div key={idx} className="order-line">
              <div>
                {i.quantity}x {i.name}
                {i.options.length > 0 && <div><small className="muted">{i.options.join(', ')}</small></div>}
                {i.notes && <div><small>“{i.notes}”</small></div>}
              </div>
              <span className="num">{formatBRL(i.totalCents)}</span>
            </div>
          ))}
          <div className="totals" style={{ marginTop: 8 }}>
            <span>Itens</span><span>{formatBRL(o.subtotalCents)}</span>
            {o.discountCents > 0 && (<><span>Desconto</span><span>− {formatBRL(o.discountCents)}</span></>)}
            {delivery && (<><span>Entrega ({o.neighborhoodName})</span><span>{formatBRL(o.deliveryFeeCents)}</span></>)}
            <span className="grand">Total</span><span className="grand">{formatBRL(o.totalCents)}</span>
          </div>
          {o.paymentIntent && (
            <p style={{ marginTop: 8 }}>
              Pagamento: {o.paymentIntent === 'pix_manual' ? 'Pix' : PAYMENT_METHOD_LABEL[o.paymentIntent as keyof typeof PAYMENT_METHOD_LABEL]}
              {o.changeForCents ? ` · troco para ${formatBRL(o.changeForCents)}` : ''}
              {o.paidCents >= o.totalCents ? ' · pago' : ''}
            </p>
          )}
        </section>
        <p style={{ textAlign: 'center' }}><Link to="/c">Fazer outro pedido</Link></p>
      </main>
    </div>
  );
}
