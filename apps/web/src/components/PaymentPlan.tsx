import { formatBRL, PAYMENT_METHOD_LABEL, type PaymentMethod } from '@guto/core';
import { Banknote, CreditCard, QrCode, Ticket, Wallet, X, type LucideIcon } from 'lucide-react';
import { MoneyInput } from './ui';

export interface PlanPart {
  method: PaymentMethod;
  amountCents: number | null;
  /** já recebido (ex.: Pix que o cliente mandou antes): registrado como pagamento ao enviar */
  paid: boolean;
}
const METHODS: PaymentMethod[] = ['cash', 'pix_manual', 'debit', 'credit', 'voucher'];
const ICON: Partial<Record<PaymentMethod, LucideIcon>> = { cash: Banknote, pix_manual: QrCode, debit: CreditCard, credit: Wallet, voucher: Ticket };
const short = (m: PaymentMethod) => (m === 'pix_manual' ? 'Pix' : PAYMENT_METHOD_LABEL[m].replace('Cartão de ', ''));

/** "Dinheiro R$ 30,00 + Pix R$ 20,00" */
export function formatPlan(plan: { method: string; amountCents: number }[] | null | undefined): string {
  if (!plan?.length) return '';
  return plan.map((p) => `${short(p.method as PaymentMethod)} ${formatBRL(p.amountCents)}`).join(' + ');
}

/**
 * Pagamento em partes: escolhe as formas (dinheiro, Pix, cartão…) e quanto em cada uma; mostra quanto falta
 * definir. Com `allowPaid`, cada parte pode ser marcada como "já pago" (ex.: Pix recebido antes).
 */
export function PaymentPlanEditor({
  total,
  parts,
  onChange,
  changeFor,
  onChangeFor,
  allowPaid,
}: {
  total: number;
  parts: PlanPart[];
  onChange: (p: PlanPart[]) => void;
  changeFor: string;
  onChangeFor: (v: string) => void;
  allowPaid: boolean;
}) {
  const sum = parts.reduce((a, p) => a + (p.amountCents ?? 0), 0);
  const left = total - sum;
  const add = (m: PaymentMethod) => onChange([...parts, { method: m, amountCents: Math.max(0, left) || null, paid: false }]);
  const set = (i: number, patch: Partial<PlanPart>) => onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const hasCash = parts.some((p) => p.method === 'cash' && !p.paid);
  return (
    <div className="plan">
      {parts.map((p, i) => {
        const Ico = ICON[p.method];
        return (
          <div key={i} className={'plan-row' + (p.paid ? ' paid' : '')}>
            <span className="plan-m">{Ico && <Ico size={16} aria-hidden />} {short(p.method)}</span>
            <MoneyInput value={p.amountCents} onChange={(v) => set(i, { amountCents: v })} aria-label={`Valor em ${short(p.method)}`} />
            {allowPaid && (
              <label className="check plan-paid">
                <input type="checkbox" checked={p.paid} onChange={(e) => set(i, { paid: e.target.checked })} /> já pago
              </label>
            )}
            <button type="button" className="btn ghost sm icon-only" aria-label={`Tirar ${short(p.method)}`} onClick={() => onChange(parts.filter((_, j) => j !== i))}>
              <X size={16} aria-hidden />
            </button>
          </div>
        );
      })}
      <div className="plan-add" role="group" aria-label="Adicionar forma de pagamento">
        <small className="muted">{parts.length ? 'Dividir com:' : 'Como vai pagar?'}</small>
        {METHODS.map((m) => (
          <button key={m} type="button" className="chip" onClick={() => add(m)}>
            + {short(m)}
          </button>
        ))}
      </div>
      {hasCash && (
        <input inputMode="decimal" placeholder="Troco para quanto? (ex.: 50,00)" value={changeFor} onChange={(e) => onChangeFor(e.target.value)} aria-label="Troco para" />
      )}
      {parts.length > 0 && total > 0 && (
        <div className={'plan-status ' + (left === 0 ? 'ok' : left < 0 ? 'bad' : 'warn')} role="status">
          {left === 0 ? 'Combinado: as partes fecham o total.' : left > 0 ? `Falta definir ${formatBRL(left)}` : `As partes passam do total em ${formatBRL(-left)}`}
        </div>
      )}
    </div>
  );
}
