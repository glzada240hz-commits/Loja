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
};

/** Conexão SSE com reconexão; ao reconectar recarrega tudo (pode ter perdido eventos). */
export function useLiveUpdates(qc: QueryClient, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let wasOffline = false;
    const connect = () => {
      setState('connecting');
      es = new EventSource('/api/events');
      es.addEventListener('hello', () => {
        setState('online');
        if (wasOffline) qc.invalidateQueries();
        wasOffline = false;
      });
      es.onmessage = (m) => {
        try {
          const ev = JSON.parse(m.data) as { type: string };
          for (const key of KEYS[ev.type] ?? []) qc.invalidateQueries({ queryKey: key });
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
      if (retry) clearTimeout(retry);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [qc, enabled]);
}
