import type { Role } from '@guto/core';
import { now } from '../lib/clock.js';
import type { EventBus } from '../lib/events.js';

export interface Device {
  deviceId: string;
  label: string;
  userId: string;
  userName: string;
  role: Role;
  online: boolean;
  /** saiu de propósito (sair do sistema ou fechar o app): não é queda de conexão */
  left: boolean;
  lastSeen: string;
  since: string;
}

/** Sem sinal por este tempo = dispositivo considerado desconectado. */
export const PRESENCE_TIMEOUT_MS = 45_000;
/** Espera após a conexão cair antes de avisar (dá tempo do aviso de saída intencional chegar). */
export const DISCONNECT_GRACE_MS = 2_500;

/**
 * Dispositivos conectados (caixa, cozinha, celulares dos atendentes...). Cada aparelho envia um
 * sinal periódico e mantém a conexão de tempo real; ao fechar a conexão ou parar de sinalizar,
 * ele aparece como desconectado para o caixa/gerência. Mantido em memória (instância única).
 */
export class PresenceRegistry {
  private devices = new Map<string, Device>();
  constructor(private bus: EventBus) {}

  seen(d: { deviceId: string; label: string; userId: string; userName: string; role: Role }) {
    const prev = this.devices.get(d.deviceId);
    const at = now().toISOString();
    const changed = !prev || !prev.online || prev.userId !== d.userId;
    this.devices.set(d.deviceId, { ...d, online: true, left: false, lastSeen: at, since: changed ? at : prev!.since });
    if (changed) this.bus.publish({ type: 'presence.changed' });
  }

  /**
   * Conexão de tempo real encerrada (rede caiu, aba fechada, servidor percebeu). Espera um instante: se o
   * aparelho avisou que saiu de propósito ou reconectou nesse meio-tempo, não é queda.
   */
  disconnected(deviceId: string, graceMs = DISCONNECT_GRACE_MS) {
    const closedAt = now().getTime();
    const mark = () => {
      const d = this.devices.get(deviceId);
      if (d?.online && new Date(d.lastSeen).getTime() <= closedAt) {
        d.online = false;
        d.since = now().toISOString();
        this.bus.publish({ type: 'presence.changed' });
      }
    };
    if (graceMs <= 0) return mark();
    setTimeout(mark, graceMs).unref?.();
  }

  /** Saída intencional (logout, aba/app fechado): fica listado como "saiu", sem gerar alerta. */
  left(deviceId: string, userId: string) {
    const d = this.devices.get(deviceId);
    if (!d || d.userId !== userId || d.left) return;
    d.online = false;
    d.left = true;
    d.since = now().toISOString();
    this.bus.publish({ type: 'presence.changed' });
  }

  sweep() {
    const limit = now().getTime() - PRESENCE_TIMEOUT_MS;
    let changed = false;
    for (const d of this.devices.values()) {
      if (d.online && new Date(d.lastSeen).getTime() < limit) {
        d.online = false;
        d.since = now().toISOString();
        changed = true;
      }
    }
    // esquece aparelhos sem sinal há mais de 12 h
    for (const [id, d] of this.devices) if (now().getTime() - new Date(d.lastSeen).getTime() > 12 * 3600_000) this.devices.delete(id);
    if (changed) this.bus.publish({ type: 'presence.changed' });
  }

  list(): Device[] {
    return [...this.devices.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.label.localeCompare(b.label));
  }
}
