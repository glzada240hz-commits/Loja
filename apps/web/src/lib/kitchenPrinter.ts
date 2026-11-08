/**
 * Impressão automática dos pedidos da cozinha no computador que tem a impressora.
 * - liga/desliga POR APARELHO (só o computador da impressora imprime; celulares nunca);
 * - só uma janela imprime (trava do navegador), mesmo com o sistema aberto em várias janelas;
 * - imprime cada envio (rodada) uma vez; reimprime como ALTERADO se a cozinha recebeu alteração e avisa
 *   CANCELADO se um pedido já impresso for cancelado;
 * - não imprime o que já existia antes de ligar.
 * Sem diálogo de impressão só no aplicativo da loja (Edge com impressão direta) e com a térmica como
 * impressora padrão do Windows; no navegador comum aparece o diálogo a cada pedido.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { get } from './api';

import { pendingPrints, testTicket, ticketLines, type PrintKind, type PrintTicket, type PrintedMap, orderRef } from '@guto/core';
export { pendingPrints, testTicket };
export type { PrintKind, PrintTicket, PrintedMap };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Via da cozinha em HTML completo (bobina 58/80 mm), letras grandes, sem preços (exceto o que cobrar na entrega).
 * O conteúdo vem de `ticketLines` (o mesmo usado pelo aplicativo do Windows). */
export function ticketHtml(t: PrintTicket, kind: PrintKind, width: number = 80): string {
  const w = width === 58 ? 58 : 80;
  const body = ticketLines(t, kind)
    .map((l) => {
      const x = esc(l.text);
      switch (l.style) {
        case 'title': return `<div class="h">${x}</div>`;
        case 'big': return `<div class="n">${x}</div>`;
        case 'place': return `<div class="p">${x}</div>`;
        case 'center': return `<div class="c">${x}</div>`;
        case 'rule': return '<hr>';
        case 'item': return `<div class="i"><b>${x}</b></div>`;
        case 'mod': return `<div class="m">${x}</div>`;
        default: return `<div>${x}</div>`;
      }
    })
    .join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cozinha ${orderRef({ number: t.orderNumber, deliveryNumber: t.deliveryNumber })}</title><style>
@page { size: ${w}mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 3mm; width: ${w}mm; font-family: 'Courier New', monospace; color: #000; font-size: ${w === 58 ? 13 : 15}px; line-height: 1.25; }
.h { text-align: center; font-weight: 800; border: 2px solid #000; padding: 2px; margin-bottom: 4px; }
.n { text-align: center; font-size: ${w === 58 ? 30 : 38}px; font-weight: 800; }
.p { text-align: center; font-size: ${w === 58 ? 18 : 22}px; font-weight: 800; }
.c { text-align: center; }
hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
.i { margin-bottom: 5px; } .i b { font-size: ${w === 58 ? 15 : 18}px; }
.m { padding-left: 10px; }
${kind === 'cancelado' ? '.i b { text-decoration: line-through; }' : ''}
</style></head><body>
${body}
</body></html>`;
}

// ------------------------------------------------------------ estado do aparelho

const KEY_ON = 'guto.kprint.on';
const KEY_SINCE = 'guto.kprint.since';
const KEY_DONE = 'guto.kprint.done';
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* armazenamento bloqueado */
    }
  },
};

export type PrinterStatus = { on: boolean; active: boolean; last: string | null; error: string | null };
let status: PrinterStatus = { on: ls.get(KEY_ON) === '1', active: false, last: null, error: null };
const listeners = new Set<() => void>();
const setStatus = (p: Partial<PrinterStatus>) => {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
};
export const useKitchenPrinterStatus = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  );

/**
 * Modo loja: no computador onde o sistema roda (aberto como localhost, que é onde fica a impressora), a
 * impressão da cozinha já vem LIGADA, sem configurar. Só na primeira vez: se alguém desligar, fica desligada.
 * Celulares e tablets acessam pelo IP da rede, então nunca ligam sozinhos.
 */
export function autoEnableOnStoreComputer(storeMode: boolean) {
  if (!storeMode || ls.get(KEY_ON) !== null) return;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
  setKitchenPrinting(true);
}

export function setKitchenPrinting(on: boolean) {
  ls.set(KEY_ON, on ? '1' : '0'); // '0' = desligada de propósito (não religa sozinha)
  if (on) ls.set(KEY_SINCE, String(Date.now()));
  setStatus({ on, error: null });
}

function readDone(): PrintedMap {
  try {
    return JSON.parse(ls.get(KEY_DONE) ?? '{}') as PrintedMap;
  } catch {
    return {};
  }
}
function saveDone(m: PrintedMap) {
  const cut = Date.now() - 36 * 3600_000;
  for (const [k, v] of Object.entries(m)) if (v.at < cut) delete m[k];
  ls.set(KEY_DONE, JSON.stringify(m));
}

/** Imprime um HTML numa moldura escondida (no aplicativo da loja sai direto na impressora padrão). */
export function printHtml(html: string): Promise<void> {
  const spy = (window as unknown as { __gutoPrintSpy?: string[] }).__gutoPrintSpy;
  if (spy) {
    spy.push(html);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    f.srcdoc = html;
    f.onload = () => {
      setTimeout(() => {
        try {
          f.contentWindow?.focus();
          f.contentWindow?.print();
        } finally {
          setTimeout(() => f.remove(), 5000);
          resolve();
        }
      }, 150);
    };
    document.body.appendChild(f);
  });
}


/**
 * Estação de impressão: roda enquanto este aparelho estiver marcado e o usuário puder ver a cozinha.
 * Confere a fila a cada aviso de mudança da cozinha e a cada 20 s (rede instável não perde pedido).
 */
export function useKitchenPrinterStation(enabled: boolean, width: number) {
  const { on } = useKitchenPrinterStatus();
  useEffect(() => {
    if (!enabled || !on) return;
    let stop = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    let busy = false;
    let again = false;

    const check = async () => {
      if (stop) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const { tickets } = await get<{ tickets: PrintTicket[] }>('/api/kitchen');
        const done = readDone();
        const since = Number(ls.get(KEY_SINCE) ?? Date.now());
        for (const { ticket, kind } of pendingPrints(tickets, done, since)) {
          if (stop) break;
          await printHtml(ticketHtml(ticket, kind, width));
          done[ticket.id] = { at: Date.now(), changedAt: ticket.changedAt, cancelled: kind === 'cancelado' || undefined };
          saveDone(done);
          setStatus({ last: `${orderRef({ number: ticket.orderNumber, deliveryNumber: ticket.deliveryNumber })} ${kind === 'novo' ? '' : `(${kind}) `}às ${hhmm(new Date().toISOString())}`, error: null });
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch (e) {
        setStatus({ error: (e as Error).message || 'Falha ao buscar os pedidos da cozinha' });
      } finally {
        busy = false;
        if (again && !stop) {
          again = false;
          void check();
        }
      }
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    // 2ª via pedida por alguém da equipe (celular, caixa, expedição)
    const reprint = async (ids: string[]) => {
      try {
        const { tickets } = await get<{ tickets: PrintTicket[] }>(`/api/kitchen/tickets?ids=${ids.join(',')}`);
        for (const t of tickets) {
          if (stop) break;
          await printHtml(ticketHtml(t, 'reimpressao', width));
          setStatus({ last: `${orderRef({ number: t.orderNumber, deliveryNumber: t.deliveryNumber })} (2ª via) às ${hhmm(new Date().toISOString())}`, error: null });
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch (err) {
        setStatus({ error: (err as Error).message || 'Falha ao imprimir a 2ª via' });
      }
    };
    const onLive = (e: Event) => {
      const detail = (e as CustomEvent<{ type: string; ticketIds?: string[] }>).detail;
      if (detail?.type === 'kitchen.reprint' && detail.ticketIds?.length) {
        void reprint(detail.ticketIds);
        return;
      }
      const type = detail?.type;
      if (type === 'kitchen.changed' || type === 'order.changed') {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void check(), 400);
      }
    };
    const start = () => {
      setStatus({ active: true });
      window.addEventListener('guto:live', onLive);
      timer = setInterval(() => void check(), 20000);
      void check();
    };
    // só uma janela deste computador imprime (as outras esperam a vez)
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks) void locks.request('guto-kitchen-printer', () => (stop ? undefined : (start(), held)));
    else start();

    return () => {
      stop = true;
      release();
      window.removeEventListener('guto:live', onLive);
      if (timer) clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      setStatus({ active: false });
    };
  }, [enabled, on, width]);
}
