import { useState } from 'react';
import { Ban, CheckCheck, HandPlatter, History, MapPin, Pencil, Phone, Plus, Printer, ReceiptText, RotateCcw, Send, Tag, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DELIVERY_STATUS_LABEL,
  KITCHEN_STATUS_LABEL,
  ORDER_STAGE_LABEL,
  ORDER_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  formatBRL,
  formatPhoneBR,
  mapsLink,
  type OrderType,
} from '@guto/core';
import { post, patch, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addressLine, formatDateTime, formatTime } from '../lib/format';
import { useOrder, useSettings } from '../lib/queries';
import type { Order, OrderEvent } from '../lib/types';
import { CustomerFields, customerPayload, type CustomerDraft } from './CustomerFields';
import { PaymentDialog } from './PaymentDialog';
import { DeliveryBadge, StageBadge, StatusBadge, TypeBadge } from './status';
import { Alert, Button, Chips, ErrorBox, Field, Loading, Modal, Money, MoneyInput, MoreMenu, Stepper, useAction, useUi } from './ui';

function eventLabel(e: OrderEvent): string {
  const d = e.data ?? {};
  switch (e.type) {
    case 'created':
      return `Pedido criado (${d.source === 'online' ? 'cardápio digital' : 'PDV'}) — ${d.items ?? ''} · ${formatBRL(d.totalCents ?? 0)}${d.discount ? ` · desconto ${formatBRL(d.discount.cents)} (${d.discount.reason})` : ''}${d.duplicateConfirmed ? ' · duplicidade confirmada' : ''}`;
    case 'items.sent':
      return `Enviado à cozinha/lançado: ${d.items}`;
    case 'items.added':
      return `Itens adicionados: ${d.items}`;
    case 'item.updated':
      return `Item alterado: ${d.item}`;
    case 'item.cancelled':
      return `Item cancelado: ${d.item} — motivo: ${d.reason}${d.stock ? ` (estoque: ${d.stock === 'loss' ? 'perda' : 'devolvido'})` : ''}`;
    case 'discount.set':
      return `Desconto ${d.type === 'percent' ? d.value / 100 + '%' : formatBRL(d.value)} = ${formatBRL(d.cents)} — ${d.reason}`;
    case 'discount.removed':
      return 'Desconto removido';
    case 'accepted':
      return 'Pedido aceito pela loja';
    case 'payment':
      return `Pagamento ${PAYMENT_METHOD_LABEL[d.method as keyof typeof PAYMENT_METHOD_LABEL] ?? d.method}: ${formatBRL(d.amountCents)}${d.changeCents ? ` (troco ${formatBRL(d.changeCents)})` : ''}${d.payer ? ` — ${d.payer}` : ''}`;
    case 'payment.refunded':
      return `Estorno ${formatBRL(d.amountCents)} — ${d.reason}`;
    case 'kitchen':
      return `Cozinha (rodada ${d.round}): ${KITCHEN_STATUS_LABEL[d.from as 'received']} → ${KITCHEN_STATUS_LABEL[d.to as 'received']}`;
    case 'stage':
      return `Etapa: ${ORDER_STAGE_LABEL[d.to as 'received'] ?? d.to}`;
    case 'updated':
      return 'Dados do pedido alterados' + (d.notes !== undefined ? ` · obs.: ${d.notes ?? '—'}` : '') + (d.deliveryFee ? ` · taxa ${formatBRL(d.deliveryFee.from)} → ${formatBRL(d.deliveryFee.to)}` : '');
    case 'bill.requested':
      return 'Atendente pediu a conta ao caixa';
    case 'served':
      return `Rodada ${d.round} entregue na mesa`;
    case 'handed_over':
      return 'Entregue ao cliente no balcão/mesa';
    case 'closed':
      return `Pedido finalizado${d.receivableCents ? ` como conta pendente (${formatBRL(d.receivableCents)} em aberto)` : ''}`;
    case 'reopened':
      return `Pedido reaberto — motivo: ${d.reason}`;
    case 'cancelled':
      return `Pedido cancelado — motivo: ${d.reason}${d.refunded ? ` · ${d.refunded} pagamento(s) estornado(s)` : ''}`;
    case 'delivery.assigned':
      return 'Atribuído a entregador';
    case 'delivery.unassigned':
      return 'Entregador removido';
    case 'delivery.departed':
      return 'Saiu para entrega';
    default:
      if (e.type.startsWith('delivery.')) return `Entrega: ${DELIVERY_STATUS_LABEL[e.type.slice(9) as 'waiting'] ?? e.type}${d.note ? ' — ' + d.note : ''}`;
      return e.type;
  }
}

export function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const q = useOrder(orderId);
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Detalhes do pedido">
        {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : q.data && <OrderDetail order={q.data} onClose={onClose} />}
      </aside>
    </div>
  );
}

export function OrderDetail({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const { can } = useAuth();
  const ui = useUi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const settings = useSettings();
  const { busy, go } = useAction();
  const [modal, setModal] = useState<null | 'pay' | 'discount' | 'edit' | 'accept'>(null);
  const refresh = (fresh?: Order) => {
    if (fresh) qc.setQueryData(['order', o.id], fresh);
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['order', o.id] });
  };
  const act = (fn: (sup?: { username: string; password: string }) => Promise<Order>, success?: string) =>
    go(async (sup) => {
      const r = await fn(sup);
      refresh(r);
      return r;
    }, { success });

  const active = o.items.filter((i) => i.status === 'active');
  const unsent = active.filter((i) => !i.sentAt);
  const editable = o.status === 'open' || o.status === 'pending';
  const canClose = o.status === 'open' && o.balanceCents <= 0 && (o.type === 'delivery' ? o.deliveryStatus === 'delivered' : o.stage === 'ready' || o.stage === 'delivered');

  const cancelOrder = async () => {
    const reason = await ui.confirm({
      title: o.status === 'pending' ? `Recusar pedido #${o.number}` : `Cancelar pedido #${o.number}`,
      message:
        o.paidCents > 0 ? (
          <Alert kind="warn">
            Este pedido tem {formatBRL(o.paidCents)} pago. Os pagamentos serão <b>estornados</b> no caixa atual.
          </Alert>
        ) : (
          'Itens ainda não preparados voltam ao estoque; os já em preparo são registrados como perda.'
        ),
      reasonLabel: 'Motivo do cancelamento',
      confirmLabel: o.status === 'pending' ? 'Recusar pedido' : 'Cancelar pedido',
      danger: true,
    });
    if (typeof reason !== 'string') return;
    await act((sup) => post(`/api/orders/${o.id}/cancel`, { version: o.version, reason, refundPayments: o.paidCents > 0, supervisor: sup }), 'Pedido cancelado');
  };

  const cancelItem = async (itemId: string, label: string, sent: boolean) => {
    const reason = await ui.confirm({
      title: `Cancelar item: ${label}`,
      message: sent ? 'O item já foi enviado à cozinha: a cozinha verá o cancelamento. Pode exigir autorização do gerente.' : undefined,
      reasonLabel: 'Motivo',
      confirmLabel: 'Cancelar item',
      danger: true,
    });
    if (typeof reason !== 'string') return;
    await act((sup) => post(`/api/orders/${o.id}/items/${itemId}/cancel`, { version: o.version, reason, supervisor: sup }), 'Item cancelado');
  };

  const close = async (receivable = false) => {
    if (receivable) {
      const ok = await ui.confirm({
        title: 'Fechar como conta pendente?',
        message: `O saldo de ${formatBRL(o.balanceCents)} ficará em "contas pendentes" até ser recebido.`,
        confirmLabel: 'Fechar como pendente',
      });
      if (!ok) return;
    }
    await act((sup) => post(`/api/orders/${o.id}/close`, { version: o.version, receivable, supervisor: sup }), 'Pedido finalizado');
  };

  const reopen = async () => {
    const reason = await ui.confirm({ title: `Reabrir pedido #${o.number}`, reasonLabel: 'Motivo da reabertura', confirmLabel: 'Reabrir' });
    if (typeof reason !== 'string') return;
    await act((sup) => post(`/api/orders/${o.id}/reopen`, { reason, supervisor: sup }), 'Pedido reaberto');
  };

  const refund = async (paymentId: string, amount: number) => {
    const reason = await ui.confirm({ title: `Estornar ${formatBRL(amount)}`, reasonLabel: 'Motivo do estorno', confirmLabel: 'Estornar', danger: true });
    if (typeof reason !== 'string') return;
    await act((sup) => post(`/api/payments/${paymentId}/refund`, { reason, supervisor: sup }), 'Pagamento estornado');
  };

  const address = addressLine(o);
  return (
    <>
      <div className="drawer-head">
        <div className="grow">
          <h2 className="hstack" style={{ gap: 8 }}>
            Pedido #{o.number} <TypeBadge type={o.type} table={o.tableLabel} tabKind={o.tabKind} />
          </h2>
          <small className="muted">
            {formatDateTime(o.createdAt)}
            {o.createdByName ? ` · ${o.createdByName}` : ''}
          </small>
        </div>
        <Button variant="ghost" icon={X} onClick={onClose} aria-label="Fechar" />
      </div>
      <div className="drawer-body">
        <div className="hstack">
          <StatusBadge status={o.status} />
          {o.status !== 'cancelled' && o.status !== 'pending' && !(o.type === 'delivery' && o.deliveryStatus && o.deliveryStatus !== 'waiting') && <StageBadge stage={o.stage} />}
          {o.deliveryStatus && o.status !== 'cancelled' && <DeliveryBadge status={o.deliveryStatus} />}
          {o.receivable && o.balanceCents > 0 && <span className="badge red">Conta pendente</span>}
          {o.source === 'online' && <span className="badge blue">Cardápio digital</span>}
        </div>

        <section className="card summary-strip" aria-label="Resumo financeiro">
          <div>
            <div className="k">Total</div>
            <div className="v">{formatBRL(o.totalCents)}</div>
          </div>
          <div>
            <div className="k">Pago</div>
            <div className="v" style={{ color: o.paidCents ? 'var(--ok)' : undefined }}>{formatBRL(o.paidCents)}</div>
          </div>
          <div>
            <div className="k">{o.balanceCents > 0 ? 'Falta receber' : 'Saldo'}</div>
            <div className={'v' + (o.balanceCents > 0 ? ' due' : '')}>{formatBRL(o.balanceCents)}</div>
          </div>
        </section>

        {o.status === 'pending' && (
          <Alert
            kind="warn"
            action={
              <span className="hstack" style={{ flexWrap: 'nowrap' }}>
                <Button variant="success" onClick={() => setModal('accept')}>
                  Aceitar pedido
                </Button>
                <Button variant="danger" onClick={cancelOrder}>
                  Recusar
                </Button>
              </span>
            }
          >
            Pedido do cardápio digital <b>aguardando aceite</b>. Só vai para a cozinha (e o cliente só é avisado) depois do aceite.
          </Alert>
        )}
        {o.status === 'cancelled' && <Alert kind="error">Cancelado em {formatDateTime(o.cancelledAt)} — {o.cancelReason}</Alert>}
        {o.billRequestedAt && o.status === 'open' && (
          <Alert kind="bill" icon={ReceiptText}>
            Conta pedida às {formatTime(o.billRequestedAt)}
            {o.billRequestedByName ? ` por ${o.billRequestedByName}` : ''}.
          </Alert>
        )}

        <section className="card">
          <div className="card-head">
            <h3>Cliente{o.type === 'delivery' ? ' e entrega' : ''}</h3>
            {editable && can('orders.edit') && (
              <Button size="sm" icon={Pencil} onClick={() => setModal('edit')}>
                Editar dados
              </Button>
            )}
          </div>
          <p style={{ margin: 0 }}>
            {o.customerName ?? <span className="muted">Sem nome</span>}
            {o.customerPhone && (
              <>
                {' · '}
                <a href={`tel:+${o.customerPhone}`}>
                  <Phone size={13} aria-hidden /> {formatPhoneBR(o.customerPhone)}
                </a>
              </>
            )}
          </p>
          {o.type === 'delivery' && (
            <p>
              {address} {o.addrReference && <small className="muted">· Ref.: {o.addrReference}</small>}{' '}
              {address && (
                <a href={mapsLink(`${o.addrStreet}, ${o.addrNumber} - ${o.neighborhoodName}`)} target="_blank" rel="noreferrer">
                  <MapPin size={13} aria-hidden /> abrir no mapa
                </a>
              )}
              {o.courierName && (
                <>
                  <br />
                  Entregador: <b>{o.courierName}</b>
                </>
              )}
              {o.deliveryIssue && (
                <>
                  <br />
                  <span className="badge red">Ocorrência</span> {o.deliveryIssue}
                </>
              )}
            </p>
          )}
          {o.etaAt && <p>Previsão: {formatTime(o.etaAt)}</p>}
          {o.notes && <Alert kind="warn">Obs. do pedido: {o.notes}</Alert>}
          {o.paymentIntent && (
            <p>
              Pagamento escolhido pelo cliente: <b>{PAYMENT_METHOD_LABEL[o.paymentIntent]}</b>
              {o.changeForCents ? ` · troco para ${formatBRL(o.changeForCents)}` : ''}
            </p>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Itens</h3>
            {editable && can('orders.edit') && o.deliveryStatus !== 'en_route' && (
              <Button size="sm" icon={Plus} onClick={() => nav(`/pdv?pedido=${o.id}`)}>
                Adicionar itens
              </Button>
            )}
          </div>
          {o.items.map((i) => (
            <div key={i.id} className={'order-line' + (i.status === 'cancelled' ? ' cancelled' : '')}>
              <div>
                <div className="name">
                  <b>{i.quantity}x</b> {i.productName}
                  {i.variantName ? ` (${i.variantName})` : ''}{' '}
                  {!i.sentAt && i.status === 'active' && o.status === 'open' && <span className="badge orange">não enviado</span>}
                </div>
                {i.options.length > 0 && <small className="muted">{i.options.map((x) => (x.quantity > 1 ? `${x.quantity}x ` : '') + x.optionName).join(', ')}</small>}
                {i.notes && <div className="note-text">“{i.notes}”</div>}
                {i.status === 'cancelled' && <small className="muted">Cancelado: {i.cancelReason}</small>}
                {i.createdByName && <div><small className="muted">lançado por {i.createdByName}</small></div>}
              </div>
              <div className="right">
                <Money cents={i.totalCents} />
                {i.status === 'active' && editable && can('orders.edit') && (
                  <div className="hstack" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
                    {!i.sentAt && (
                      <Stepper
                        label={i.productName}
                        value={i.quantity}
                        min={1}
                        onChange={(v) => act(() => patch(`/api/orders/${o.id}/items/${i.id}`, { version: o.version, quantity: v }))}
                      />
                    )}
                    <Button size="sm" variant="ghost" icon={X} onClick={() => cancelItem(i.id, i.productName, !!i.sentAt)} aria-label={`Cancelar ${i.productName}`} title="Cancelar item" />
                  </div>
                )}
              </div>
            </div>
          ))}
          {unsent.length > 0 && o.status === 'open' && (
            <Button variant="primary" block busy={busy} icon={Send} style={{ marginTop: 8 }} onClick={() => act(() => post(`/api/orders/${o.id}/send`, { version: o.version }), 'Itens enviados')}>
              Enviar {unsent.length} item(ns) pendente(s) à cozinha
            </Button>
          )}
          {o.tickets.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {o.tickets.map((t) => (
                <div key={t.id} className="hstack" style={{ fontSize: '.85rem', padding: '2px 0' }}>
                  <b>Rodada {t.round}</b>
                  <span className="muted">
                    {formatTime(t.createdAt)} · {t.createdByName ?? 'cardápio digital'}
                  </span>
                  <span className="spacer" />
                  {t.servedAt ? (
                    <span className="badge">entregue {formatTime(t.servedAt)}{t.servedByName ? ` · ${t.servedByName}` : ''}</span>
                  ) : (
                    <span className={'badge ' + (t.status === 'ready' ? 'green' : t.status === 'preparing' ? 'yellow' : 'blue')}>
                      {KITCHEN_STATUS_LABEL[t.status].toLowerCase()}
                      {t.readyAt ? ' ' + formatTime(t.readyAt) : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Valores</h3>
            {editable && can('orders.edit') && (
              <Button size="sm" icon={Tag} onClick={() => setModal('discount')}>
                {o.discountCents > 0 ? 'Alterar desconto' : 'Aplicar desconto'}
              </Button>
            )}
          </div>
          <div className="totals">
            <span>Itens</span>
            <Money cents={o.subtotalCents} />
            {o.discountCents > 0 && (
              <>
                <span>
                  Desconto{o.discountType === 'percent' && o.discountValue ? ` (${o.discountValue / 100}%)` : ''} <small className="muted">— {o.discountReason}</small>
                </span>
                <span className="num">− {formatBRL(o.discountCents)}</span>
              </>
            )}
            {o.type === 'delivery' && (
              <>
                <span>Taxa de entrega</span>
                <Money cents={o.deliveryFeeCents} />
              </>
            )}
            <span className="grand">Total</span>
            <Money className="grand" cents={o.totalCents} />
            <span>Pago</span>
            <Money cents={o.paidCents} />
            <b>Saldo</b>
            <b className="num">{formatBRL(o.balanceCents)}</b>
          </div>
        </section>

        {o.payments.length > 0 && (
          <section className="card">
            <h3>Pagamentos</h3>
            {o.payments.map((p) => (
              <div key={p.id} className="order-line">
                <div>
                  <b>{PAYMENT_METHOD_LABEL[p.method]}</b> {p.payerLabel && <small>· {p.payerLabel}</small>}
                  <br />
                  <small className="muted">
                    {formatDateTime(p.createdAt)} · {p.userName}
                    {p.tenderedCents && p.changeCents ? ` · recebido ${formatBRL(p.tenderedCents)}, troco ${formatBRL(p.changeCents)}` : ''}
                  </small>
                  {p.status === 'refunded' && (
                    <div>
                      <span className="badge red">Estornado</span> <small>{p.refundReason}</small>
                    </div>
                  )}
                </div>
                <div className="right">
                  <span className={p.status === 'refunded' ? 'strike' : ''}>
                    <Money cents={p.amountCents} />
                  </span>
                  {p.status === 'confirmed' && o.status === 'open' && can('payments.create') && (
                    <div>
                      <Button size="sm" variant="ghost" onClick={() => refund(p.id, p.amountCents)}>
                        Estornar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="card">
          <h3 className="hstack" style={{ gap: 6 }}>
            <History size={16} aria-hidden /> Histórico
          </h3>
          <ul className="timeline">
            {o.events.map((e) => (
              <li key={e.id}>
                <small className="muted">{formatDateTime(e.createdAt)}</small> — {eventLabel(e)}
                {e.userName && <small className="muted"> · {e.userName}</small>}
                {e.authorizedByName && <small className="muted"> · autorizado por {e.authorizedByName}</small>}
              </li>
            ))}
          </ul>
          <details style={{ marginTop: 8 }}>
            <summary className="muted" style={{ cursor: 'pointer', fontSize: '.8rem' }}>
              Código interno (suporte)
            </summary>
            <small className="muted mono">{o.id}</small>
          </details>
        </section>
      </div>
      <div className="drawer-foot">
        {o.status === 'open' && can('orders.close') && !canClose && (
          <small className="muted" style={{ width: '100%' }}>
            Para finalizar: {[o.balanceCents > 0 && `receber ${formatBRL(o.balanceCents)}`, !(o.type === 'delivery' ? o.deliveryStatus === 'delivered' : o.stage === 'ready' || o.stage === 'delivered') && (o.type === 'delivery' ? 'concluir a entrega' : 'aguardar a cozinha (pronto)')].filter(Boolean).join(' e ')}.
          </small>
        )}
        <div className="primary-actions">
          {(o.status === 'open' || (o.status === 'closed' && o.receivable)) && o.balanceCents > 0 && can('payments.create') && (
            <Button variant="success" size="lg" onClick={() => setModal('pay')}>
              Receber {formatBRL(o.balanceCents)}
            </Button>
          )}
          {o.status === 'open' && o.type !== 'delivery' && o.stage === 'ready' && (
            <Button icon={HandPlatter} size="lg" onClick={() => act(() => post(`/api/orders/${o.id}/handover`, {}), 'Entregue ao cliente')}>
              Entregue ao cliente
            </Button>
          )}
          {o.status === 'open' && can('orders.close') && (
            <Button variant="dark" size="lg" icon={CheckCheck} disabled={!canClose} busy={busy} onClick={() => close(false)}>
              Finalizar pedido
            </Button>
          )}
          {o.status === 'closed' && <Button icon={RotateCcw} onClick={reopen}>Reabrir</Button>}
        </div>
        <MoreMenu>
          <a href={`/imprimir/${o.id}?via=cliente&w=${settings.data?.printWidth ?? 80}`} target="_blank" rel="noreferrer" role="menuitem">
            <Printer size={16} aria-hidden /> Imprimir comprovante
          </a>
          <a href={`/imprimir/${o.id}?via=cozinha&w=${settings.data?.printWidth ?? 80}`} target="_blank" rel="noreferrer" role="menuitem">
            <Printer size={16} aria-hidden /> Imprimir via da cozinha
          </a>
          {o.status === 'open' && o.balanceCents > 0 && can('orders.close') && (
            <button type="button" role="menuitem" onClick={() => close(true)}>
              <ReceiptText size={16} aria-hidden /> Fechar como conta pendente
            </button>
          )}
          {o.status === 'open' && (
            <>
              <hr />
              <button type="button" role="menuitem" className="danger" onClick={cancelOrder}>
                <Ban size={16} aria-hidden /> Cancelar pedido…
              </button>
            </>
          )}
        </MoreMenu>
      </div>
      {modal === 'pay' && <PaymentDialog order={o} onClose={() => setModal(null)} onPaid={(fresh) => { refresh(fresh); if (fresh.balanceCents <= 0) setModal(null); }} />}
      {modal === 'discount' && <DiscountDialog order={o} onClose={() => setModal(null)} onSaved={(fresh) => { refresh(fresh); setModal(null); }} />}
      {modal === 'edit' && <EditOrderDialog order={o} onClose={() => setModal(null)} onSaved={(fresh) => { refresh(fresh); setModal(null); }} />}
      {modal === 'accept' && <AcceptDialog order={o} onClose={() => setModal(null)} onSaved={(fresh) => { refresh(fresh); setModal(null); }} />}
    </>
  );
}

function DiscountDialog({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: (o: Order) => void }) {
  const [type, setType] = useState<'percent' | 'amount'>(order.discountType ?? 'percent');
  const [pct, setPct] = useState(order.discountType === 'percent' && order.discountValue ? String(order.discountValue / 100) : '10');
  const [amount, setAmount] = useState<number | null>(order.discountType === 'amount' ? order.discountValue : null);
  const [reason, setReason] = useState(order.discountReason ?? '');
  const { busy, go } = useAction();
  const bp = Math.round(Number(pct.replace(',', '.')) * 100);
  const value = type === 'percent' ? bp : amount;
  const valid = !!value && value > 0 && (type === 'amount' || bp <= 10000) && reason.trim().length > 0;
  const save = (discount: unknown) =>
    go(async (sup) => onSaved(await put<Order>(`/api/orders/${order.id}/discount`, { version: order.version, discount, supervisor: sup })), { success: 'Desconto atualizado' });
  return (
    <Modal
      title="Desconto"
      onClose={onClose}
      footer={
        <>
          {order.discountCents > 0 && (
            <Button variant="danger" onClick={() => save(null)} busy={busy}>
              Remover desconto
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valid} busy={busy} onClick={() => save({ type, value, reason: reason.trim() })}>
            Aplicar
          </Button>
        </>
      }
    >
      <Chips label="Tipo" value={type} onChange={setType} options={[{ id: 'percent', label: 'Percentual' }, { id: 'amount', label: 'Valor (R$)' }]} />
      <div style={{ height: 10 }} />
      {type === 'percent' ? (
        <Field label="Percentual (%)" hint="Incide só sobre os itens (não sobre a entrega).">
          <input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
      ) : (
        <Field label="Valor do desconto">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
      )}
      <Field label="Motivo" hint="Obrigatório. Acima do limite do caixa será pedida autorização do gerente.">
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </Field>
    </Modal>
  );
}

function EditOrderDialog({ order: o, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: (o: Order) => void }) {
  const settings = useSettings();
  const [type, setType] = useState<OrderType>(o.type);
  const [table, setTable] = useState(o.tableLabel ?? '');
  const [notes, setNotes] = useState(o.notes ?? '');
  const [eta, setEta] = useState('');
  const [fee, setFee] = useState<number | null>(null);
  const [cust, setCust] = useState<CustomerDraft>({
    name: o.customerName ?? '',
    phone: o.customerPhone ?? '',
    street: o.addrStreet ?? '',
    number: o.addrNumber ?? '',
    complement: o.addrComplement ?? '',
    reference: o.addrReference ?? '',
    neighborhoodId: o.neighborhoodId ?? '',
    waOptIn: o.waOptIn,
  });
  const { busy, go } = useAction();
  const delivery = type === 'delivery';
  const save = () =>
    go(async (sup) => {
      const p = customerPayload(cust, delivery);
      const body: Record<string, unknown> = {
        version: o.version,
        type,
        tableLabel: type === 'table' ? table : null,
        notes: notes || null,
        customer: p.customer,
        supervisor: sup,
      };
      if (delivery) body.address = p.address;
      if (eta) body.etaMinutes = Number(eta);
      if (fee != null) body.deliveryFeeCents = fee;
      onSaved(await patch<Order>(`/api/orders/${o.id}`, body));
    }, { success: 'Pedido atualizado' });
  return (
    <Modal
      wide
      title={`Editar pedido #${o.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <Field label="Tipo" group>
        <Chips label="Tipo" value={type} onChange={setType} options={(['counter', 'takeout', 'delivery', 'table'] as const).map((t) => ({ id: t, label: ORDER_TYPE_LABEL[t] }))} />
      </Field>
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
      <CustomerFields value={cust} onChange={setCust} delivery={delivery} />
      <div className="row">
        <Field label="Nova previsão (minutos a partir de agora)">
          <input inputMode="numeric" value={eta} onChange={(e) => setEta(e.target.value.replace(/\D/g, ''))} placeholder="ex.: 30" />
        </Field>
        {delivery && (
          <Field label="Taxa de entrega manual" hint="Deixe vazio para usar a taxa do bairro. Exige permissão.">
            <MoneyInput value={fee} onChange={setFee} />
          </Field>
        )}
      </div>
      <Field label="Observação do pedido">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </Field>
    </Modal>
  );
}

function AcceptDialog({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: (o: Order) => void }) {
  const [eta, setEta] = useState(order.type === 'delivery' ? 50 : 25);
  const { busy, go } = useAction();
  return (
    <Modal
      title={`Aceitar pedido #${order.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button
            variant="success"
            busy={busy}
            onClick={() => go(async () => onSaved(await post<Order>(`/api/orders/${order.id}/accept`, { version: order.version, etaMinutes: eta })), { success: 'Pedido aceito e enviado à cozinha' })}
          >
            Aceitar e enviar à cozinha
          </Button>
        </>
      }
    >
      <p>
        Total {formatBRL(order.totalCents)} · {order.items.length} item(ns)
      </p>
      <Field label="Previsão informada ao cliente (minutos)" group>
        <div className="chips">
          {[20, 30, 40, 50, 60, 75, 90].map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={eta === m} onClick={() => setEta(m)}>
              {m} min
            </button>
          ))}
        </div>
      </Field>
    </Modal>
  );
}
