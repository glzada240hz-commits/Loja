import { useEffect, useState } from 'react';
import { formatBRL, normalizePhoneBR } from '@guto/core';
import { get } from '../lib/api';
import { useNeighborhoods } from '../lib/queries';
import { Field } from './ui';

export interface CustomerDraft {
  name: string;
  phone: string;
  street: string;
  number: string;
  complement: string;
  reference: string;
  neighborhoodId: string;
  waOptIn: boolean;
}
export const emptyCustomer: CustomerDraft = { name: '', phone: '', street: '', number: '', complement: '', reference: '', neighborhoodId: '', waOptIn: false };

/** Dados do cliente com busca pelo telefone (preenche nome e último endereço). */
export function CustomerFields({ value, onChange, delivery }: { value: CustomerDraft; onChange: (v: CustomerDraft) => void; delivery: boolean }) {
  const nbs = useNeighborhoods();
  const [found, setFound] = useState<any>(null);
  const set = (patch: Partial<CustomerDraft>) => onChange({ ...value, ...patch });

  useEffect(() => {
    const p = normalizePhoneBR(value.phone);
    if (!p) {
      setFound(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      get(`/api/customers?phone=${encodeURIComponent(p)}`, ctrl.signal)
        .then((c) => {
          setFound(c);
          if (c && !value.name) {
            const a = c.addresses?.[0];
            onChange({
              ...value,
              name: c.name,
              ...(a && !value.street
                ? { street: a.street, number: a.number, complement: a.complement ?? '', reference: a.reference ?? '', neighborhoodId: a.neighborhoodId ?? '' }
                : {}),
            });
          }
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.phone]);

  const nb = nbs.data?.find((n) => n.id === value.neighborhoodId);
  return (
    <div>
      <div className="row">
        <Field label="Telefone" hint={found ? `Cliente cadastrado · ${found.history?.length ?? 0} pedido(s)` : undefined}>
          <input inputMode="tel" autoComplete="off" value={value.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="(11) 98888-7777" />
        </Field>
        <Field label="Nome">
          <input value={value.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />
        </Field>
      </div>
      {found?.notes && <div className="alert warn">Obs. do cliente: {found.notes}</div>}
      {delivery && (
        <>
          {found?.addresses?.length > 1 && (
            <Field label="Endereços salvos">
              <select
                value=""
                onChange={(e) => {
                  const a = found.addresses.find((x: any) => x.id === e.target.value);
                  if (a) set({ street: a.street, number: a.number, complement: a.complement ?? '', reference: a.reference ?? '', neighborhoodId: a.neighborhoodId ?? '' });
                }}
              >
                <option value="">Escolher…</option>
                {found.addresses.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.street}, {a.number} — {a.neighborhoodName}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="row">
            <Field label="Rua">
              <input value={value.street} onChange={(e) => set({ street: e.target.value })} maxLength={150} />
            </Field>
            <Field label="Número">
              <input value={value.number} onChange={(e) => set({ number: e.target.value })} maxLength={20} style={{ maxWidth: 110 }} />
            </Field>
          </div>
          <div className="row">
            <Field label="Bairro" hint={nb ? `Taxa ${formatBRL(nb.feeCents)} · ~${nb.etaMinutes} min` : undefined}>
              <select value={value.neighborhoodId} onChange={(e) => set({ neighborhoodId: e.target.value })}>
                <option value="">Selecione…</option>
                {nbs.data
                  ?.filter((n) => n.active)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} — {formatBRL(n.feeCents)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Complemento">
              <input value={value.complement} onChange={(e) => set({ complement: e.target.value })} maxLength={100} />
            </Field>
          </div>
          <Field label="Ponto de referência">
            <input value={value.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={150} />
          </Field>
        </>
      )}
      {value.phone && (
        <label className="check">
          <input type="checkbox" checked={value.waOptIn} onChange={(e) => set({ waOptIn: e.target.checked })} />
          Cliente aceita receber atualizações do pedido pelo WhatsApp
        </label>
      )}
    </div>
  );
}

export function customerPayload(c: CustomerDraft, delivery: boolean) {
  return {
    customer: c.name || c.phone ? { name: c.name || null, phone: c.phone || null } : null,
    address: delivery
      ? { street: c.street, number: c.number, complement: c.complement || null, reference: c.reference || null, neighborhoodId: c.neighborhoodId }
      : null,
    waOptIn: c.waOptIn,
  };
}
