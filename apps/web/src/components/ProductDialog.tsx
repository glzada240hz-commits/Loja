import { useMemo, useState } from 'react';
import { formatBRL, unitTotal, validateOptionSelections } from '@guto/core';
import type { CartLine, MenuProduct } from '../lib/types';
import { Button, Field, Modal, Stepper } from './ui';

/** Escolha de tamanho, adicionais (com mínimo/máximo), quantidade e observação. */
export function ProductDialog({
  product,
  initial,
  onClose,
  onConfirm,
  publicView,
}: {
  product: MenuProduct;
  initial?: CartLine;
  onClose: () => void;
  onConfirm: (line: CartLine) => void;
  publicView?: boolean;
}) {
  const variants = product.variants.filter((v) => !publicView || v.available);
  const [variantId, setVariant] = useState(initial?.variantId ?? variants.find((v) => v.available)?.id ?? variants[0]!.id);
  const [qty, setQty] = useState(initial?.quantity ?? 1);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [sel, setSel] = useState<Record<string, number>>(() => Object.fromEntries((initial?.options ?? []).map((o) => [o.optionId, o.quantity])));
  const [tried, setTried] = useState(false);
  const variant = product.variants.find((v) => v.id === variantId)!;

  const selection = Object.entries(sel)
    .filter(([, q]) => q > 0)
    .map(([optionId, quantity]) => ({ optionId, quantity }));
  const errors = useMemo(
    () =>
      validateOptionSelections(
        product.groups.map((g) => ({ ...g, options: g.options.map((o) => ({ id: o.id, name: o.name, available: o.available })) })),
        selection,
      ),
    [product.groups, selection],
  );
  const allOptions = product.groups.flatMap((g) => g.options);
  const chosen = selection.map((s) => {
    const o = allOptions.find((x) => x.id === s.optionId)!;
    return { optionId: o.id, name: o.name, priceCents: o.priceCents, quantity: s.quantity };
  });
  const unit = unitTotal({ unitPriceCents: variant.priceCents, options: chosen });
  const unavailable = !product.available || !variant.available;

  const setOpt = (groupId: string, optionId: string, q: number) => {
    const g = product.groups.find((x) => x.id === groupId)!;
    setSel((prev) => {
      const next = { ...prev, [optionId]: q };
      // grupo de escolha única: troca a seleção
      if (g.maxSelect === 1 && q > 0) for (const o of g.options) if (o.id !== optionId) next[o.id] = 0;
      return next;
    });
  };

  const confirm = () => {
    setTried(true);
    if (errors.length || unavailable) return;
    onConfirm({
      key: initial?.key ?? Math.random().toString(36).slice(2),
      variantId,
      productName: product.name,
      variantName: variant.name === 'Único' ? null : variant.name,
      unitPriceCents: variant.priceCents,
      options: chosen,
      quantity: qty,
      notes: notes.trim(),
    });
  };

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="lg" onClick={confirm} disabled={unavailable}>
            {initial ? 'Atualizar' : 'Adicionar'} · {formatBRL(unit * qty)}
          </Button>
        </>
      }
    >
      {product.description && <p className="muted">{product.description}</p>}
      {product.kind === 'combo' && product.combo.length > 0 && (
        <p>
          <b>Inclui:</b> {product.combo.map((c) => `${c.quantity}x ${c.label}`).join(', ')}
        </p>
      )}
      {unavailable && <div className="alert error">Este item está indisponível no momento.</div>}
      {product.variants.length > 1 && (
        <fieldset className="opt-group">
          <legend>Tamanho</legend>
          {variants.map((v) => (
            <label key={v.id} className="opt-row">
              <input type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariant(v.id)} disabled={!v.available} />
              <span className="grow">
                {v.name} {!v.available && <span className="badge red">indisponível</span>}
              </span>
              <b className="num">{formatBRL(v.priceCents)}</b>
            </label>
          ))}
        </fieldset>
      )}
      {product.groups.map((g) => {
        const count = g.options.reduce((a, o) => a + (sel[o.id] ?? 0), 0);
        const rule =
          g.minSelect > 0 && g.maxSelect > 0
            ? g.minSelect === g.maxSelect
              ? `Escolha ${g.minSelect}`
              : `Escolha de ${g.minSelect} a ${g.maxSelect}`
            : g.minSelect > 0
              ? `Mínimo ${g.minSelect}`
              : g.maxSelect > 0
                ? `Até ${g.maxSelect}`
                : 'Opcional';
        return (
          <fieldset key={g.id} className="opt-group">
            <legend>
              {g.name} <small className="muted">({rule})</small> {g.minSelect > 0 && <span className="badge orange">obrigatório</span>}
            </legend>
            {g.options
              .filter((o) => !publicView || o.available)
              .map((o) => {
                const q = sel[o.id] ?? 0;
                const atMax = g.maxSelect > 0 && count >= g.maxSelect && q === 0;
                return (
                  <div key={o.id} className="opt-row">
                    {g.maxSelect === 1 ? (
                      <input type="radio" aria-label={o.name} name={'g' + g.id} checked={q > 0} disabled={!o.available} onChange={() => setOpt(g.id, o.id, 1)} />
                    ) : o.priceCents === 0 ? (
                      <input type="checkbox" aria-label={o.name} checked={q > 0} disabled={!o.available || atMax} onChange={(e) => setOpt(g.id, o.id, e.target.checked ? 1 : 0)} />
                    ) : null}
                    <span className="grow">
                      {o.name} {!o.available && <span className="badge red">indisponível</span>}
                    </span>
                    {o.priceCents > 0 && <span className="num muted">+ {formatBRL(o.priceCents)}</span>}
                    {g.maxSelect !== 1 && o.priceCents > 0 && (
                      <Stepper
                        label={o.name}
                        value={q}
                        min={0}
                        max={o.available ? (g.maxSelect > 0 ? Math.min(10, q + g.maxSelect - count) : 10) : 0}
                        onChange={(v) => setOpt(g.id, o.id, v)}
                      />
                    )}
                  </div>
                );
              })}
          </fieldset>
        );
      })}
      <div className="row">
        <Field label="Quantidade" group>
          <Stepper label="quantidade" value={qty} min={1} max={99} onChange={setQty} />
        </Field>
      </div>
      <Field label="Observação do item" hint="Ex.: bem passado, sem sal. Aparece na cozinha.">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
      </Field>
      {tried && errors.length > 0 && (
        <div className="alert error" role="alert">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function lineTotal(l: CartLine) {
  return unitTotal({ unitPriceCents: l.unitPriceCents, options: l.options }) * l.quantity;
}

export function lineToItemInput(l: CartLine) {
  return {
    variantId: l.variantId,
    quantity: l.quantity,
    options: l.options.map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
    notes: l.notes || null,
  };
}
