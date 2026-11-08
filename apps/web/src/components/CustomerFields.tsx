import { useEffect, useRef, useState } from 'react';
import { formatBRL, normalizePhoneBR, parseAddressBR, searchFilter, orderRef } from '@guto/core';
import { ClipboardPaste, RotateCcw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { useNeighborhoods } from '../lib/queries';
import { Field } from './ui';
import type { Neighborhood } from '../lib/types';

export interface CustomerDraft {
  name: string;
  phone: string;
  street: string;
  number: string;
  complement: string;
  reference: string;
  neighborhoodId: string;
  waOptIn: boolean;
  /** entrega: com (true) ou sem (false) molho verde; null = ainda não escolhido */
  greenSauce: boolean | null;
}
export const emptyCustomer: CustomerDraft = { name: '', phone: '', street: '', number: '', complement: '', reference: '', neighborhoodId: '', waOptIn: false, greenSauce: null };

/** Dados do cliente com busca pelo telefone (preenche nome e último endereço). */
export function CustomerFields({
  value,
  onChange,
  delivery,
  onRepeat,
}: {
  value: CustomerDraft;
  onChange: (v: CustomerDraft) => void;
  delivery: boolean;
  /** "repetir último pedido": recebe o id do pedido anterior do cliente */
  onRepeat?: (orderId: string, number: number) => void;
}) {
  const nbs = useNeighborhoods();
  const streetsQ = useQuery({
    queryKey: ['streets', value.neighborhoodId],
    queryFn: () => get<string[]>(`/api/neighborhoods/${value.neighborhoodId}/streets`),
    enabled: delivery && !!value.neighborhoodId,
    staleTime: 300_000,
  });
  const streets = streetsQ.data ?? [];
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
  const activeNbs = (nbs.data ?? []).filter((n) => n.active);
  const [pasted, setPasted] = useState('');
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const applyPaste = (text: string) => {
    const a = parseAddressBR(text, activeNbs);
    const found = activeNbs.find((n) => n.id === a.neighborhoodId);
    onChange({
      ...value,
      street: a.street || value.street,
      number: a.number || value.number,
      complement: a.complement || value.complement,
      reference: a.reference || value.reference,
      neighborhoodId: found ? found.id : value.neighborhoodId,
    });
    setPasteMsg(found ? `Bairro identificado: ${found.name} (taxa ${formatBRL(found.feeCents)}). Confira os campos abaixo.` : 'Bairro não identificado no texto: busque o bairro abaixo. Confira a rua e o número.');
  };
  const last = (found?.history ?? []).find((h: any) => h.status !== 'cancelled');
  return (
    <div>
      {onRepeat && last && (
        <button type="button" className="btn sm" style={{ marginBottom: 10 }} onClick={() => onRepeat(last.id, last.number)}>
          <RotateCcw className="icon" aria-hidden /> Repetir último pedido de {found.name?.split(' ')[0] ?? 'cliente'} ({orderRef(last)} · {formatBRL(last.totalCents)})
        </button>
      )}
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
          {/* colar o endereço que o cliente mandou: separa rua/número/complemento e acha o bairro (taxa) */}
          <Field label="Colar endereço do cliente" hint={pasteMsg ?? 'Cole aqui o endereço como o cliente mandou: o sistema separa a rua, o número e acha o bairro e a taxa.'}>
            <textarea
              rows={2}
              value={pasted}
              placeholder="Ex.: Rua das Acácias, 120, apto 2 - Santa Martinha"
              onChange={(e) => setPasted(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (!text.trim()) return;
                e.preventDefault();
                setPasted(text);
                applyPaste(text);
              }}
            />
          </Field>
          {pasted.trim() && (
            <button type="button" className="btn sm" style={{ marginTop: -4, marginBottom: 8 }} onClick={() => applyPaste(pasted)}>
              <ClipboardPaste className="icon" aria-hidden /> Preencher com o texto colado
            </button>
          )}
          {/* bairro primeiro: define a taxa; a rua sugere as já usadas naquele bairro */}
          <div className="row">
            <Field label="Bairro" hint={nb ? `Taxa ${formatBRL(nb.feeCents)} · ~${nb.etaMinutes} min` : 'Digite para buscar. Cadastre os bairros e as taxas em Bairros e taxas'}>
              <NeighborhoodPicker list={activeNbs} value={value.neighborhoodId} onChange={(id) => set({ neighborhoodId: id })} />
            </Field>
          </div>
          <div className="row">
            <Field label="Rua">
              <input
                value={value.street}
                onChange={(e) => set({ street: e.target.value })}
                onPaste={(e) => {
                  // endereço completo colado na rua (com número/bairro): separa sozinho
                  const text = e.clipboardData.getData('text');
                  if (!/\d/.test(text) && !/[,\n-]/.test(text)) return;
                  e.preventDefault();
                  setPasted(text);
                  applyPaste(text);
                }}
                maxLength={150} list={streets.length ? 'ruas-do-bairro' : undefined} autoComplete="off" />
              {streets.length > 0 && (
                <datalist id="ruas-do-bairro">
                  {streets.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              )}
            </Field>
            <Field label="Número">
              <input value={value.number} onChange={(e) => set({ number: e.target.value })} maxLength={20} style={{ maxWidth: 110 }} />
            </Field>
          </div>
          <Field label="Molho verde" group hint={value.greenSauce === null ? 'Pergunte ao cliente: sai na comanda da cozinha.' : undefined}>
            <div className="segmented" role="radiogroup" aria-label="Molho verde">
              {[
                { v: true, label: 'Com molho verde' },
                { v: false, label: 'Sem molho verde' },
              ].map((o) => (
                <button key={String(o.v)} type="button" role="radio" aria-checked={value.greenSauce === o.v} aria-pressed={value.greenSauce === o.v} onClick={() => set({ greenSauce: o.v })}>
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Complemento">
            <input value={value.complement} onChange={(e) => set({ complement: e.target.value })} maxLength={100} />
          </Field>
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

/** Bairro com busca (ignora acentos e aceita erro de digitação); mostra a taxa de cada um. */
function NeighborhoodPicker({ list, value, onChange }: { list: Neighborhood[]; value: string; onChange: (id: string) => void }) {
  const sel = list.find((n) => n.id === value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const blur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matches = searchFilter(list, q, (n) => ({ name: n.name })).slice(0, 40);
  const pick = (n: Neighborhood) => {
    onChange(n.id);
    setQ('');
    setOpen(false);
  };
  return (
    <div className="nb-pick">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls="nb-list"
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={sel ? undefined : 'Buscar bairro…'}
        value={open ? q : sel ? `${sel.name} — ${formatBRL(sel.feeCents)}` : q}
        onFocus={(e) => {
          setOpen(true);
          setQ('');
          setHi(0);
          e.currentTarget.select();
        }}
        onBlur={() => (blur.current = setTimeout(() => setOpen(false), 150))}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, matches.length - 1));
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0));
          else if (e.key === 'Enter' && open && matches[hi]) {
            e.preventDefault();
            pick(matches[hi]!);
          } else if (e.key === 'Escape') setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && (
        <ul className="nb-list" id="nb-list" role="listbox" aria-label="Bairros">
          {matches.length === 0 && <li className="nb-empty">Nenhum bairro com esse nome</li>}
          {matches.map((n, i) => (
            <li
              key={n.id}
              role="option"
              aria-selected={n.id === value}
              className={(i === hi ? 'hi ' : '') + (n.id === value ? 'sel' : '')}
              onMouseDown={(e) => {
                e.preventDefault();
                if (blur.current) clearTimeout(blur.current);
                pick(n);
              }}
            >
              <span>{n.name}</span>
              <b className="num">{formatBRL(n.feeCents)}</b>
            </li>
          ))}
        </ul>
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
    ...(delivery ? { greenSauce: c.greenSauce } : {}),
  };
}
