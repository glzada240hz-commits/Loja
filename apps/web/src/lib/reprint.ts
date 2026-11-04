import { useCallback } from 'react';
import { useUi } from '../components/ui';
import { post } from './api';

/** 2ª via da comanda da cozinha (perdeu a via): sai na impressora da cozinha. */
export function useReprintKitchen() {
  const ui = useUi();
  return useCallback(
    async (by: { ticketId?: string; orderId?: string }) => {
      try {
        const r = await post<{ via: 'impressora' | 'computador'; count: number; orderNumber: number }>('/api/kitchen/reprint', by);
        ui.toast(
          r.via === 'impressora'
            ? `2ª via do pedido #${r.orderNumber} enviada para a impressora da cozinha`
            : `2ª via do pedido #${r.orderNumber} enviada ao computador que imprime a cozinha`,
          'ok',
        );
      } catch (e) {
        ui.toast((e as Error).message || 'Não foi possível imprimir a 2ª via', 'error');
      }
    },
    [ui],
  );
}
