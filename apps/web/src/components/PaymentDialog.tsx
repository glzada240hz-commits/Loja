import { useMemo, useRef, useState } from 'react';
import { formatBRL, PAYMENT_METHOD_LABEL, splitEvenly, type PaymentMethod } from '@guto/core';
import { newIdemKey, post } from '../lib/api';
import type { Order } from '../lib/types';
import { Button, Chips, Field, Modal, MoneyInput, useAction } from './ui';

const METHODS: PaymentMethod[] = ['cash', 'pix_manual', 'debit', 'credit', 'voucher'];

/** Registro de pagamento (total, parcial ou dividido) com cálculo de troco. O servidor confere tudo. */
export function PaymentDialog({ order, onClose, onPaid }: { order: Order; onClose: () => void; onPaid: (o: Order) => void }) {
  const balance = order.balanceCents;
  const [method, setMethod] = useState<PaymentMethod>(order.paymentIntent && order.paymentIntent !== 'pix_integrated' ? order.paymentIntent : 'cash');
  const [amount, setAmount] = useState<number | null>(balance);
  const [tendered, setTendered] = useState<number | null>(order.changeForCents ?? null);
  const [payer, setPayer] = useState('');
  const [ways, setWays] = useState(1);
  const key = useRef(newIdemKey());
  const { busy, go } = useAction();

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
          },
          { idempotencyKey: key.current },
        );
        key.current = newIdemKey();
        onPaid(r.order);
        return r;
      },
      { success: 'Pagamento registrado' },
    );

  return (
    <Modal
      title={`Receber — pedido #${order.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Fechar</Button>
          <Button variant="success" size="lg" busy={busy} disabled={invalid} onClick={submit}>
            Registrar {amount ? formatBRL(Math.min(amount, balance)) : ''}
          </Button>
        </>
      }
    >
      <div className="totals" style={{ marginBottom: 12 }}>
        <span>Total do pedido</span>
        <b className="num">{formatBRL(order.totalCents)}</b>
        <span>Já pago</span>
        <span className="num">{formatBRL(order.paidCents)}</span>
        <span className="grand">Saldo</span>
        <span className="grand num">{formatBRL(balance)}</span>
      </div>
      <Field label="Forma de pagamento" group>
        <Chips label="Forma de pagamento" value={method} onChange={setMethod} options={METHODS.map((m) => ({ id: m, label: PAYMENT_METHOD_LABEL[m] }))} />
      </Field>
      {method === 'pix_manual' && (
        <div className="alert warn">
          Confirme o crédito no extrato/app do banco <b>antes</b> de registrar. Comprovante enviado pelo cliente não garante o recebimento.
        </div>
      )}
      <div className="row">
        <Field label="Valor a abater">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Dividir conta">
          <select value={ways} onChange={(e) => setWays(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'Não dividir' : `${n} pessoas`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {parts.length > 0 && (
        <div className="hstack" style={{ marginBottom: 10 }}>
          <small className="muted">Partes:</small>
          {parts.map((p, i) => (
            <Button key={i} size="sm" onClick={() => setAmount(p)}>
              {formatBRL(p)}
            </Button>
          ))}
        </div>
      )}
      {method === 'cash' && (
        <>
          <Field label="Valor recebido em dinheiro" hint="Para calcular o troco">
            <MoneyInput value={tendered} onChange={setTendered} />
          </Field>
          <div className="hstack" style={{ marginBottom: 10 }}>
            {[applied, 2000, 5000, 10000, 20000]
              .filter((v, i, a) => v >= applied && a.indexOf(v) === i)
              .map((v) => (
                <Button key={v} size="sm" onClick={() => setTendered(v)}>
                  {v === applied ? 'Exato' : formatBRL(v)}
                </Button>
              ))}
          </div>
          {cashShort ? (
            <div className="alert info">Recebido menor que o valor: será registrado pagamento parcial de {formatBRL(tendered ?? 0)}.</div>
          ) : (
            <div className="stat" aria-live="polite">
              <div className="label">Troco</div>
              <div className="value">{formatBRL(change)}</div>
            </div>
          )}
        </>
      )}
      <Field label="Identificação (opcional)" hint="Ex.: Pessoa 1, João">
        <input value={payer} onChange={(e) => setPayer(e.target.value)} maxLength={60} />
      </Field>
    </Modal>
  );
}
