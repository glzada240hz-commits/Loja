import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBRL, PAYMENT_METHOD_LABEL, splitEvenly, type PaymentMethod, orderTitle } from '@guto/core';
import { newIdemKey, post } from '../lib/api';
import type { Order } from '../lib/types';
import { Banknote, CheckCircle2, CreditCard, Printer, QrCode, Ticket, Wallet, type LucideIcon } from 'lucide-react';
import { openNota } from '../lib/print';
import { formatPlan } from './PaymentPlan';
import { useSettings } from '../lib/queries';
import { Alert, Button, Field, Modal, MoneyInput, Stepper, useAction } from './ui';

const METHODS: PaymentMethod[] = ['cash', 'pix_manual', 'debit', 'credit', 'voucher'];
const METHOD_ICON: Partial<Record<PaymentMethod, LucideIcon>> = { cash: Banknote, pix_manual: QrCode, debit: CreditCard, credit: Wallet, voucher: Ticket };

/**
 * Registro de pagamento (total, parcial ou dividido) com cálculo de troco. O servidor confere tudo.
 * "Imprimir conta" tira a nota não fiscal para o cliente conferir; quitado, mostra o troco e "Imprimir nota".
 */
export function PaymentDialog({ order, onClose, onPaid }: { order: Order; onClose: () => void; onPaid: (o: Order) => void }) {
  const balance = order.balanceCents;
  const [method, setMethod] = useState<PaymentMethod>(order.paymentIntent && order.paymentIntent !== 'pix_integrated' ? order.paymentIntent : 'cash');
  const [amount, setAmount] = useState<number | null>(balance);
  const [tendered, setTendered] = useState<number | null>(order.changeForCents ?? null);
  const [payer, setPayer] = useState('');
  const [ways, setWays] = useState(1);
  // conta dividida por itens (ways = 0): cada pessoa paga os itens dela
  const byItems = ways === 0;
  const [pick, setPick] = useState<Record<string, number>>({});
  const activeItems = order.items.filter((i) => i.status === 'active');
  const paidBy = useMemo(() => {
    const m = new Map<string, { qty: number; who: string[] }>();
    for (const p of order.payments.filter((x) => x.status === 'confirmed'))
      for (const it of p.items ?? []) {
        const cur = m.get(it.itemId) ?? { qty: 0, who: [] };
        cur.qty += it.quantity;
        if (p.payerLabel && !cur.who.includes(p.payerLabel)) cur.who.push(p.payerLabel);
        m.set(it.itemId, cur);
      }
    return m;
  }, [order.payments]);
  const splitPeople = new Set(order.payments.filter((p) => p.status === 'confirmed' && p.items?.length).map((p) => p.payerLabel ?? '')).size;
  const nextPerson = `Cliente ${String.fromCharCode(65 + Math.min(splitPeople, 25))}`;
  // desconto do pedido dividido na mesma proporção dos itens
  const factor = order.subtotalCents > 0 ? (order.subtotalCents - order.discountCents) / order.subtotalCents : 1;
  const pickSum = Math.round(activeItems.reduce((a, i) => a + (pick[i.id] ?? 0) * (i.totalCents / i.quantity), 0) * factor);
  useEffect(() => {
    if (!byItems) return;
    setAmount(Math.min(pickSum, balance) || null);
    if (!payer) setPayer(nextPerson);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byItems, pickSum, balance]);
  const key = useRef(newIdemKey());
  const { busy, go } = useAction();
  const settings = useSettings();
  const width = settings.data?.printWidth ?? 80;
  const [done, setDone] = useState<{ order: Order; change: number } | null>(null);

  const parts = useMemo(() => (ways > 1 ? splitEvenly(balance, ways) : []), [balance, ways]);
  const applied = Math.min(amount ?? 0, balance);
  const change = method === 'cash' && tendered != null && amount != null ? Math.max(0, tendered - applied) : 0;
  const cashShort = method === 'cash' && tendered != null && amount != null && tendered < applied;
  const invalid = !amount || amount <= 0 || amount > balance || (method === 'cash' && tendered != null && tendered <= 0);

  const submit = () =>
    go(
      async () => {
        const r = await post<{ result: { changeCents: number; balanceCents: number }; order: Order }>(
          `/api/orders/${order.id}/payments`,
          {
            method,
            amountCents: amount,
            tenderedCents: method === 'cash' ? (tendered ?? amount) : null,
            payerLabel: payer || null,
            items: byItems ? activeItems.filter((i) => (pick[i.id] ?? 0) > 0).map((i) => ({ itemId: i.id, quantity: pick[i.id]! })) : null,
          },
          { idempotencyKey: key.current },
        );
        key.current = newIdemKey();
        if (byItems) {
          // próxima pessoa
          setPick({});
          setPayer('');
          setTendered(null);
        }
        if (r.order.balanceCents <= 0) {
          setDone({ order: r.order, change: r.result.changeCents });
          if (settings.data?.autoPrintReceipt) openNota(r.order.id, width);
        }
        onPaid(r.order);
        return r;
      },
      { success: 'Pagamento registrado' },
    );

  const quick = [applied, 2000, 5000, 10000, 20000].filter((v, i, a) => v >= applied && a.indexOf(v) === i).slice(0, 5);
  const registered = cashShort ? (tendered ?? 0) : applied;

  if (done)
    return (
      <Modal
        title={`${orderTitle(done.order)} pago`}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Concluir</Button>
            <Button variant="primary" size="lg" icon={Printer} onClick={() => openNota(done.order.id, width)}>
              Imprimir nota
            </Button>
          </>
        }
      >
        <div className="pay-done">
          <CheckCircle2 size={44} color="var(--ok)" aria-hidden />
          <p className="pay-done-total">{formatBRL(done.order.totalCents)}</p>
          <p className="muted">Pedido quitado · {done.order.place}</p>
          {done.change > 0 && (
            <div className="pay-change" aria-live="polite">
              <span className="k">Troco a devolver</span>
              <span className="v">{formatBRL(done.change)}</span>
            </div>
          )}
          <small className="muted">A nota impressa não é documento fiscal.</small>
        </div>
      </Modal>
    );

  return (
    <Modal title={`Receber — ${orderTitle(order)}`} onClose={onClose} className="pay-modal" bare>
      <div className="pay-band" aria-label="Resumo do pedido">
        <div>
          <div className="k">Total do pedido</div>
          <div className="v">{formatBRL(order.totalCents)}</div>
        </div>
        <div>
          <div className="k">Já pago</div>
          <div className="v">{formatBRL(order.paidCents)}</div>
        </div>
        <div>
          <div className="k">Falta receber</div>
          <div className="v due">{formatBRL(balance)}</div>
        </div>
      </div>
      <div className="pay">
        <div className="pay-col">
          {order.paymentPlan && order.paymentPlan.length > 1 && (
            <div className="plan-chips" role="group" aria-label="Pagamento combinado">
              <small className="muted">Combinado:</small>
              {order.paymentPlan.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setMethod(p.method);
                    setAmount(Math.min(p.amountCents, balance));
                    setTendered(p.method === 'cash' ? (order.changeForCents ?? null) : null);
                  }}
                >
                  {formatPlan([p])}
                </button>
              ))}
            </div>
          )}
          <div role="group" aria-labelledby="pay-m">
            <span className="pay-label" id="pay-m">
              Forma de pagamento
            </span>
            <div className="pay-methods">
              {METHODS.map((m) => {
                const Ico = METHOD_ICON[m];
                return (
                  <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}>
                    {Ico && <Ico className="icon" aria-hidden />}
                    {PAYMENT_METHOD_LABEL[m]}
                  </button>
                );
              })}
            </div>
          </div>
          {method === 'pix_manual' && (
            <Alert kind="warn">
              Confirme o crédito no extrato/app do banco <b>antes</b> de registrar. Comprovante enviado pelo cliente não garante o recebimento.
            </Alert>
          )}
          <div className="pay-amount">
            <Field label="Valor deste pagamento">
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Dividir conta">
              <select value={ways} onChange={(e) => setWays(Number(e.target.value))}>
                {[1, 0, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'Não dividir' : n === 0 ? 'Por itens (cada um paga o seu)' : `${n} pessoas (partes iguais)`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {byItems && (
            <div className="split-items" role="group" aria-label="Itens desta pessoa">
              <b>Itens de {payer || nextPerson}</b>
              {activeItems.map((i) => {
                const paid = paidBy.get(i.id);
                const left = i.quantity - (paid?.qty ?? 0);
                const q = pick[i.id] ?? 0;
                return (
                  <div key={i.id} className={'split-row' + (left <= 0 ? ' done' : q > 0 ? ' on' : '')}>
                    <span className="grow">
                      {i.quantity}x {i.productName}
                      {i.options.length > 0 && <small className="muted"> · {i.options.map((o) => o.optionName).join(', ')}</small>}
                      {paid && <small className="split-paid"> · pago {paid.qty} ({paid.who.join(', ')})</small>}
                    </span>
                    <span className="num">{formatBRL(Math.round(i.totalCents / i.quantity))}</span>
                    {left > 0 ? (
                      <Stepper label={i.productName} value={q} min={0} max={left} onChange={(v) => setPick({ ...pick, [i.id]: v })} />
                    ) : (
                      <span className="badge green">pago</span>
                    )}
                  </div>
                );
              })}
              <small className="muted">Total desta pessoa: <b>{formatBRL(pickSum)}</b>{order.discountCents > 0 ? ' (com o desconto do pedido dividido)' : ''}</small>
            </div>
          )}
          {parts.length > 0 && (
            <div className="pay-quick" style={{ marginTop: -6 }}>
              <small className="muted" style={{ alignSelf: 'center' }}>Partes:</small>
              {parts.map((p, i) => (
                <Button key={i} size="sm" onClick={() => setAmount(p)}>
                  {formatBRL(p)}
                </Button>
              ))}
            </div>
          )}
          <small className="muted">Parte em dinheiro e parte no Pix/cartão? Registre a primeira parte com o valor dela; a janela continua aberta com o que falta.</small>
          <Field label={byItems ? 'Quem está pagando' : 'Identificação (opcional)'} hint="Ex.: Cliente A, João">
            <input value={payer} onChange={(e) => setPayer(e.target.value)} maxLength={60} />
          </Field>
        </div>
        <div className="pay-col">
          {method === 'cash' ? (
            <>
              <div className="pay-big-input">
                <Field label="Valor recebido em dinheiro" hint="Para calcular o troco">
                  <MoneyInput value={tendered} onChange={setTendered} />
                </Field>
              </div>
              <div className="pay-quick">
                {quick.map((v) => (
                  <Button key={v} size="sm" onClick={() => setTendered(v)}>
                    {v === applied ? 'Exato' : formatBRL(v)}
                  </Button>
                ))}
              </div>
              {cashShort ? (
                <Alert kind="info">Recebido menor que o valor: será registrado pagamento parcial de {formatBRL(tendered ?? 0)}.</Alert>
              ) : (
                <div className="pay-change" aria-live="polite">
                  <span className="k">Troco a devolver</span>
                  <span className="v" data-testid="troco">
                    {formatBRL(change)}
                  </span>
                </div>
              )}
            </>
          ) : (
            <Alert kind="info">Sem troco nesta forma de pagamento. Confira a maquininha ou o extrato antes de registrar.</Alert>
          )}
          <div className="pay-summary" aria-live="polite">
            <b>Será registrado</b>
            {invalid ? (
              <small className="muted">Informe um valor entre R$ 0,01 e {formatBRL(balance)}.</small>
            ) : (
              <dl className="dl">
                <dt>{PAYMENT_METHOD_LABEL[method]}</dt>
                <dd>{formatBRL(registered)}</dd>
                {method === 'cash' && tendered != null && !cashShort && (
                  <>
                    <dt>Recebido em dinheiro</dt>
                    <dd>{formatBRL(tendered)}</dd>
                  </>
                )}
                <dt>Restará a receber</dt>
                <dd>{formatBRL(Math.max(0, balance - registered))}</dd>
              </dl>
            )}
          </div>
        </div>
      </div>
      <div className="pay-foot">
        <Button onClick={onClose}>Fechar</Button>
        <Button icon={Printer} onClick={() => openNota(order.id, width)} title="Nota não fiscal para o cliente conferir antes de pagar">
          Imprimir conta
        </Button>
        <Button variant="success" size="lg" busy={busy} disabled={invalid} onClick={submit}>
          Registrar {amount ? formatBRL(Math.min(amount, balance)) : ''}
        </Button>
      </div>
    </Modal>
  );
}
