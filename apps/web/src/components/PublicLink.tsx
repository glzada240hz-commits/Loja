import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Globe } from 'lucide-react';
import { get, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, useAction, useUi } from './ui';

interface PublicLinkInfo {
  supported: boolean;
  available: boolean;
  enabled: boolean;
  status: 'off' | 'starting' | 'online' | 'error';
  url: string | null;
  menuUrl: string | null;
  error: string | null;
}

function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import('qrcode').then((m) => m.toString(text, { type: 'svg', margin: 1 })).then((s) => alive && setSvg(s));
    return () => {
      alive = false;
    };
  }, [text]);
  return <div className="qr-box" style={{ width: 150, height: 150 }} role="img" aria-label={`QR code: ${text}`} dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />;
}

/**
 * Cardápio digital na internet pelo túnel do computador da loja: liga/desliga (dono), link, QR e mensagem
 * pronta para o WhatsApp. Só funciona com o computador da loja ligado e o sistema aberto.
 */
export function PublicLinkCard({ compact }: { compact?: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const ui = useUi();
  const { busy, go } = useAction();
  const q = useQuery({ queryKey: ['public-link'], queryFn: () => get<PublicLinkInfo>('/api/system/public-link'), refetchInterval: (d) => (d.state.data?.status === 'starting' ? 2000 : 15000) });
  const d = q.data;
  if (!d) return null;
  if (!d.supported) {
    if (compact) return null;
    return (
      <section className="card public-card">
        <h3 className="hstack" style={{ gap: 8, marginTop: 0 }}><Globe size={18} aria-hidden /> Cardápio digital na internet</h3>
        <p className="muted">Disponível no aplicativo Bar do Guto instalado no computador da loja (Windows).</p>
      </section>
    );
  }
  const toggle = (on: boolean) =>
    go(async () => {
      await put('/api/settings', { publicMenuOnline: on });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['public-link'] }), 800);
    }, { success: on ? 'Ligando o cardápio na internet…' : 'Cardápio fora da internet' });
  const msg = d.menuUrl ? `Faça seu pedido pelo nosso cardápio: ${d.menuUrl}` : '';
  const copy = (t: string) => {
    void navigator.clipboard?.writeText(t).then(() => ui.toast('Copiado', 'ok'), () => ui.toast('Não foi possível copiar: selecione e copie', 'error'));
  };
  return (
    <section className={'card public-card' + (compact ? ' compact' : '')}>
      <h3 className="hstack" style={{ gap: 8, marginTop: 0 }}>
        <Globe size={18} aria-hidden /> Cardápio digital na internet
        <span className={'badge ' + (d.status === 'online' ? 'green' : d.status === 'error' ? 'red' : d.status === 'starting' ? 'orange' : '')}>
          {d.status === 'online' ? 'no ar' : d.status === 'starting' ? 'ligando…' : d.status === 'error' ? 'com problema' : 'desligado'}
        </span>
      </h3>
      {!compact && (
        <p className="muted" style={{ marginTop: 0 }}>
          O cliente abre o link de casa, escolhe e envia; o pedido chega aqui como <b>aguardando aceite</b>. Só funciona com <b>este computador ligado</b> e
          o Bar do Guto aberto — loja fechada, link fora do ar. De fora, só o cardápio abre: caixa, login e relatórios ficam bloqueados.
        </p>
      )}
      {!d.available && <Alert kind="warn">O túnel não veio nesta instalação. Reinstale a versão mais nova do Bar do Guto.</Alert>}
      {d.status === 'online' && d.menuUrl ? (
        <div className="public-link">
          <Qr text={d.menuUrl} />
          <div className="public-link-text">
            <b className="mono" style={{ wordBreak: 'break-all' }}>{d.menuUrl}</b>
            <div className="hstack" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              <Button size="sm" icon={Copy} onClick={() => copy(d.menuUrl!)}>Copiar link</Button>
              <Button size="sm" icon={Copy} onClick={() => copy(msg)}>Copiar mensagem para o WhatsApp</Button>
              <a className="btn sm" href={d.menuUrl} target="_blank" rel="noreferrer">Abrir</a>
            </div>
            <small className="muted">
              O endereço <b>muda</b> sempre que o computador ou o sistema reinicia (túnel gratuito). Copie o link novo e atualize a mensagem automática do
              WhatsApp Business ao abrir a loja. Endereço fixo exige um domínio próprio (pago).
            </small>
          </div>
        </div>
      ) : d.status === 'starting' ? (
        <p>Ligando… pode levar até 30 segundos.</p>
      ) : d.status === 'error' ? (
        <Alert kind="error">{d.error ?? 'O túnel não respondeu.'} Confira a internet deste computador.</Alert>
      ) : null}
      {can('settings.manage') && d.available && (
        <div style={{ marginTop: 8 }}>
          {d.enabled ? (
            <Button busy={busy} onClick={() => toggle(false)}>Tirar o cardápio da internet</Button>
          ) : (
            <Button variant="primary" busy={busy} icon={Globe} onClick={() => toggle(true)}>Colocar o cardápio na internet</Button>
          )}
        </div>
      )}
    </section>
  );
}
