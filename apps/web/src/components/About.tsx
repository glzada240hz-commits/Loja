import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatDateTime } from '../lib/format';
import { Alert, Button, Modal } from './ui';

interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
  code?: string;
  id: string;
}

/** Ajuda → Sobre: qual versão está aberta neste aparelho e se é a mesma que o servidor está entregando. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [server, setServer] = useState<BuildInfo | null | 'erro'>(null);
  const [sw, setSw] = useState<string>('verificando…');
  useEffect(() => {
    fetch('/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setServer)
      .catch(() => setServer('erro'));
    if (!('serviceWorker' in navigator)) setSw('não usado neste navegador');
    else
      void navigator.serviceWorker.getRegistration().then((r) =>
        setSw(!r ? 'não instalado (modo desenvolvimento ou navegador sem suporte)' : r.waiting ? 'versão nova baixada, aguardando aplicar' : 'ativo e atualizado'),
      );
  }, []);
  const same = server && server !== 'erro' && server.id === __BUILD__.id;

  /** Descarta a interface guardada no aparelho e recarrega do servidor (dados não são afetados). */
  const forceReload = async () => {
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = (await caches?.keys?.()) ?? [];
      await Promise.all(keys.map((k) => caches.delete(k)));
    } finally {
      location.reload();
    }
  };

  return (
    <Modal
      title="Sobre este sistema"
      onClose={onClose}
      footer={
        <>
          <Button icon={RefreshCw} onClick={() => void forceReload()}>
            Recarregar a versão do servidor
          </Button>
          <Button variant="primary" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      <dl className="dl">
        <dt>Versão aberta neste aparelho</dt>
        <dd className="mono">{__BUILD__.id}</dd>
        <dt>Compilada em</dt>
        <dd>{formatDateTime(__BUILD__.builtAt)}</dd>
        <dt>Commit (se houver Git)</dt>
        <dd className="mono">{__BUILD__.commit}</dd>
        <dt>Versão no servidor</dt>
        <dd className="mono">{server === null ? 'verificando…' : server === 'erro' ? 'não disponível' : server.id}</dd>
        <dt>Cache do aplicativo</dt>
        <dd>{sw}</dd>
      </dl>
      <div style={{ marginTop: 12 }}>
        {same ? (
          <Alert kind="ok">Este aparelho está com a mesma versão que o servidor.</Alert>
        ) : server && server !== 'erro' ? (
          <Alert kind="warn">
            Este aparelho está com uma versão diferente da do servidor. Toque em <b>Recarregar a versão do servidor</b>.
          </Alert>
        ) : null}
      </div>
      <p style={{ margin: '0 0 6px' }}>
        <a href="/senha">Alterar minha senha</a>
      </p>
      <small className="muted">Bar do Guto — sistema de gestão. Pedidos e valores ficam no servidor; recarregar não apaga dados.</small>
    </Modal>
  );
}
