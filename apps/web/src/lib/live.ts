import { useEffect, useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';

export type ConnState = 'connecting' | 'online' | 'offline';
let state: ConnState = 'connecting';
const listeners = new Set<() => void>();
function setState(s: ConnState) {
  if (s === state) return;
  state = s;
  listeners.forEach((l) => l());
}
export function useConnection() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Mapeia eventos do servidor para as consultas que devem ser recarregadas. */
const KEYS: Record<string, string[][]> = {
  'order.changed': [['orders'], ['order'], ['tables'], ['deliveries'], ['kitchen'], ['reports']],
  'kitchen.changed': [['kitchen'], ['order']],
  'delivery.changed': [['deliveries'], ['courier'], ['order'], ['courierPending']],
  'cash.changed': [['cash'], ['day']],
  'day.changed': [['day'], ['cash'], ['orders']],
  'menu.changed': [['menu'], ['settings'], ['groups']],
  'stock.changed': [['stock']],
  'whatsapp.changed': [['wa']],
  'bill.requested': [['orders'], ['order'], ['tables']],
  'presence.changed': [['presence']],
};

/** Identificador estável deste aparelho (para o caixa saber qual dispositivo caiu). */
export function deviceId(): string {
  const make = () => 'dev-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  try {
    let id = localStorage.getItem('guto-device-id');
    if (!id) {
      id = make();
      localStorage.setItem('guto-device-id', id);
    }
    return id;
  } catch {
    return ((window as unknown as { __gutoDev?: string }).__gutoDev ??= make());
  }
}

export function deviceKind(): string {
  const w = Math.min(window.screen?.width ?? 1200, window.innerWidth || 1200);
  return w < 600 ? 'celular' : w < 1100 ? 'tablet' : 'computador';
}

/** Conexão SSE com reconexão; ao reconectar recarrega tudo (pode ter perdido eventos). */
export function useLiveUpdates(qc: QueryClient, enabled: boolean, label = 'Dispositivo') {
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let wasOffline = false;
    const connect = () => {
      setState('connecting');
      es = new EventSource(`/api/events?device=${encodeURIComponent(deviceId())}&label=${encodeURIComponent(label.slice(0, 60))}`);
      es.addEventListener('hello', () => {
        setState('online');
        if (wasOffline) qc.invalidateQueries();
        wasOffline = false;
      });
      es.onmessage = (m) => {
        try {
          const ev = JSON.parse(m.data) as { type: string };
          for (const key of KEYS[ev.type] ?? []) qc.invalidateQueries({ queryKey: key });
          // avisos para a tela (ex.: mesa pediu a conta)
          window.dispatchEvent(new CustomEvent('guto:live', { detail: ev }));
        } catch {
          /* ignora */
        }
      };
      es.onerror = () => {
        wasOffline = true;
        setState('offline');
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    // sinal de vida: o caixa vê quais aparelhos estão conectados
    const ping = () =>
      fetch('/api/presence', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'guto' },
        body: JSON.stringify({ device: deviceId(), label: label.slice(0, 60) }),
      }).catch(() => setState('offline'));
    void ping();
    const pinger = setInterval(ping, 15000);
    const onOffline = () => setState('offline');
    const onOnline = () => {
      es?.close();
      if (retry) clearTimeout(retry);
      wasOffline = true;
      connect();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      es?.close();
      clearInterval(pinger);
      if (retry) clearTimeout(retry);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [qc, enabled, label]);
}
