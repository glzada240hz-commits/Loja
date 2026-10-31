import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Smartphone, WifiOff } from 'lucide-react';
import { ROLE_LABEL } from '@guto/core';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatTime } from '../lib/format';
import { Button, Modal, useUi } from './ui';

interface Device {
  deviceId: string;
  label: string;
  userName: string;
  role: keyof typeof ROLE_LABEL;
  online: boolean;
  lastSeen: string;
  since: string;
}

const RECENT_MS = 30 * 60 * 1000;

function beep(freq = 660) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.12;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  } catch {
    /* sem áudio */
  }
}

/**
 * Avisos para o caixa/gerência: mesa pediu a conta e aparelho (celular de atendente,
 * tablet da cozinha...) que perdeu a conexão. Mostra também quantos aparelhos estão online.
 */
export function StaffAlerts() {
  const { can } = useAuth();
  const ui = useUi();
  const enabled = can('orders.close');
  const devices = useQuery({ queryKey: ['presence'], queryFn: () => get<Device[]>('/api/presence'), enabled, refetchInterval: 20000 });
  const prev = useRef<Map<string, boolean> | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const onLive = (e: Event) => {
      const ev = (e as CustomEvent).detail as { type: string; place?: string; by?: string; number?: number };
      if (ev.type === 'bill.requested') {
        ui.toast(`${ev.place} pediu a conta (pedido #${ev.number}, ${ev.by})`, 'info');
        beep(880);
      }
    };
    window.addEventListener('guto:live', onLive);
    return () => window.removeEventListener('guto:live', onLive);
  }, [enabled, ui]);

  useEffect(() => {
    if (!devices.data) return;
    const now = new Map(devices.data.map((d) => [d.deviceId, d.online]));
    if (prev.current) {
      for (const d of devices.data) {
        if (prev.current.get(d.deviceId) === true && !d.online) {
          ui.toast(`${d.label} perdeu a conexão`, 'error');
          beep(330);
        }
        if (prev.current.get(d.deviceId) === false && d.online) ui.toast(`${d.label} reconectou`, 'ok');
      }
    }
    prev.current = now;
  }, [devices.data, ui]);

  if (!enabled || !devices.data) return null;
  const online = devices.data.filter((d) => d.online).length;
  // só alerta quedas recentes: sessões encerradas há muito tempo não são "aparelho sem conexão"
  const offline = devices.data.filter((d) => !d.online && Date.now() - new Date(d.since).getTime() < RECENT_MS);
  return (
    <>
      <button
        type="button"
        className={'conn ' + (offline.length ? 'bad' : 'neutral')}
        onClick={() => setOpen(true)}
        aria-label="Aparelhos conectados"
        title="Aparelhos conectados"
      >
        {offline.length ? <WifiOff className="icon" aria-hidden /> : <Smartphone className="icon" aria-hidden />}
        {online}
        {offline.length ? ` · ${offline.length} sem conexão` : <span className="sr-only"> aparelho(s) online</span>}
      </button>
      {open && (
        <Modal title="Aparelhos" onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>Fechar</Button>}>
          <p className="muted">Aparelhos que usaram o sistema nas últimas horas. “Sem conexão” = sem sinal há mais de 45 segundos; depois de 30 minutos o aparelho passa a “inativo” e deixa de gerar alerta.</p>
          <table className="table">
            <tbody>
              {devices.data.map((d) => (
                <tr key={d.deviceId}>
                  <td>
                    <b>{d.label}</b>
                    <div>
                      <small className="muted">{ROLE_LABEL[d.role]}</small>
                    </div>
                  </td>
                  <td className="right">
                    {d.online ? (
                      <span className="badge green">online</span>
                    ) : Date.now() - new Date(d.since).getTime() < RECENT_MS ? (
                      <span className="badge red">sem conexão desde {formatTime(d.since)}</span>
                    ) : (
                      <span className="badge">inativo desde {formatTime(d.since)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </>
  );
}
