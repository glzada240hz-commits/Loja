import { EventEmitter } from 'node:events';

/**
 * Barramento interno de eventos para atualização em tempo real (SSE).
 * Os eventos carregam apenas identificadores; o cliente recarrega os dados pela API
 * (que aplica as permissões do usuário).
 */
export type LiveEvent =
  | { type: 'order.changed'; orderId: string; number?: number }
  | { type: 'kitchen.changed'; orderId: string }
  | { type: 'delivery.changed'; orderId?: string; courierId?: string | null }
  | { type: 'cash.changed' }
  | { type: 'day.changed' }
  | { type: 'menu.changed' }
  | { type: 'stock.changed' }
  | { type: 'whatsapp.changed'; contactId?: string }
  | { type: 'bill.requested'; orderId: string; number: number; place: string; by: string }
  | { type: 'presence.changed' }
  /** interno: há mensagens na fila de envio */
  | { type: 'wa.outbox' };

export class EventBus extends EventEmitter {
  publish(ev: LiveEvent) {
    this.emit('event', ev);
  }
}
