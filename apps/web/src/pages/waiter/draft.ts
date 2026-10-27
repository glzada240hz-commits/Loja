import { useCallback, useEffect, useState } from 'react';
import { newIdemKey } from '../../lib/api';
import type { CartLine } from '../../lib/types';

/**
 * Rascunho do atendente, guardado no aparelho: sobrevive a recarregar a página ou perder a conexão.
 *
 * Estados:
 * - editing: montando o pedido;
 * - sending: requisição em andamento (botão bloqueado);
 * - unconfirmed: a conexão caiu durante o envio. O servidor PODE ter recebido. O rascunho fica
 *   travado e o reenvio usa a MESMA chave — se o servidor já tinha recebido, devolve a mesma
 *   resposta em vez de lançar outra rodada.
 */
export type DraftState = 'editing' | 'sending' | 'unconfirmed';

export interface Draft {
  lines: CartLine[];
  key: string;
  state: DraftState;
  error: string | null;
}

const empty = (): Draft => ({ lines: [], key: newIdemKey(), state: 'editing', error: null });

function read(storageKey: string): Draft {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const d = JSON.parse(raw) as Draft;
      // um envio interrompido por fechar a página continua não confirmado
      return d.state === 'sending' ? { ...d, state: 'unconfirmed', error: 'O envio foi interrompido antes da confirmação. Reenvie para confirmar.' } : d;
    }
  } catch {
    /* armazenamento indisponível */
  }
  return empty();
}

export function useDraft(target: string) {
  const storageKey = 'guto-draft:' + target;
  const [draft, setDraftState] = useState<Draft>(() => read(storageKey));

  useEffect(() => {
    setDraftState(read(storageKey));
  }, [storageKey]);

  const setDraft = useCallback(
    (d: Draft | ((prev: Draft) => Draft)) => {
      setDraftState((prev) => {
        const next = typeof d === 'function' ? d(prev) : d;
        try {
          if (next.lines.length === 0 && next.state === 'editing') localStorage.removeItem(storageKey);
          else localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignora */
        }
        return next;
      });
    },
    [storageKey],
  );

  /** Alterar o conteúdo gera nova chave (é outro envio). Bloqueado enquanto há envio não confirmado. */
  const editLines = useCallback(
    (fn: (lines: CartLine[]) => CartLine[]) =>
      setDraft((p) => (p.state !== 'editing' ? p : { ...p, lines: fn(p.lines), key: newIdemKey(), error: null })),
    [setDraft],
  );

  const clear = useCallback(() => setDraft(empty()), [setDraft]);

  return { draft, setDraft, editLines, clear };
}

export function moveDraft(fromTarget: string, toTarget: string) {
  try {
    const raw = localStorage.getItem('guto-draft:' + fromTarget);
    if (!raw) return;
    const d = JSON.parse(raw) as Draft;
    localStorage.setItem('guto-draft:' + toTarget, JSON.stringify({ ...d, key: newIdemKey(), state: 'editing', error: null }));
    localStorage.removeItem('guto-draft:' + fromTarget);
  } catch {
    /* ignora */
  }
}
