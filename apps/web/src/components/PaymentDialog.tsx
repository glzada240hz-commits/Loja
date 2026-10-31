import { useMemo, useRef, useState } from 'react';
import { formatBRL, PAYMENT_METHOD_LABEL, splitEvenly, type PaymentMethod } from '@guto/core';
import { newIdemKey, post } from '../lib/api';
import type { Order } from '../lib/types';
import { Banknote, CreditCard, QrCode, Ticket, Wallet, type LucideIcon } from 'lucide-react';
import { Alert, Button, Field, Modal, MoneyInput, useAction } from './ui';

const METHODS: PaymentMethod[] = ['cash', 'pix_manual', 'debit', 'credit', 'voucher'];
const METHOD_ICON: Partial<Record<PaymentMethod, LucideIcon>> = { cash: Banknote, pix_manual: QrCode, debit: CreditCard, credit: Wallet, voucher: Ticket };

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
      <div className="summary-strip card" style={{ marginBottom: 14 }}>
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
      <Field label="Forma de pagamento" group>
        <div className="segmented" role="group" aria-label="Forma de pagamento" style={{ gridAutoColumns: 'minmax(0, 1fr)' }}>
          {METHODS.map((m) => {
            const Ico = METHOD_ICON[m];
            return (
              <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} style={{ flexDirection: 'column', minHeight: 56, whiteSpace: 'normal', lineHeight: 1.1, gap: 4 }}>
                {Ico && <Ico className="icon" aria-hidden />}
                {PAYMENT_METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>
      </Field>
      {method === 'pix_manual' && (
        <Alert kind="warn">
          Confirme o crédito no extrato/app do banco <b>antes</b> de registrar. Comprovante enviado pelo cliente não garante o recebimento.
        </Alert>
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
          {cashShort && <Alert kind="info">Recebido menor que o valor: será registrado pagamento parcial de {formatBRL(tendered ?? 0)}.</Alert>}
        </>
      )}
      <Field label="Identificação (opcional)" hint="Ex.: Pessoa 1, João">
        <input value={payer} onChange={(e) => setPayer(e.target.value)} maxLength={60} />
      </Field>
      {!invalid && (
        <div className="card" aria-live="polite" style={{ background: 'var(--surface-2)' }}>
          <b style={{ display: 'block', marginBottom: 6 }}>Será registrado</b>
          <dl className="dl" style={{ margin: 0 }}>
            <dt>{PAYMENT_METHOD_LABEL[method]}</dt>
            <dd>{formatBRL(cashShort ? (tendered ?? 0) : applied)}</dd>
            {method === 'cash' && tendered != null && !cashShort && (
              <>
                <dt>Recebido em dinheiro</dt>
                <dd>{formatBRL(tendered)}</dd>
                <dt style={{ fontWeight: 700, color: 'var(--ink)' }}>Troco a devolver</dt>
                <dd data-testid="troco" style={{ fontSize: '1.4rem', fontWeight: 800 }}>{formatBRL(change)}</dd>
              </>
            )}
            <dt>Restará a receber</dt>
            <dd>{formatBRL(Math.max(0, balance - (cashShort ? (tendered ?? 0) : applied)))}</dd>
          </dl>
        </div>
      )}
    </Modal>
  );
}
