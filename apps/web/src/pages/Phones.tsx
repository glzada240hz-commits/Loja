import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Printer, Smartphone, Wifi } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Alert, Button, Field, Loading, useAction, useUi } from '../components/ui';
import { post } from '../lib/api';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { printHtml, setKitchenPrinting, testTicket, ticketHtml, useKitchenPrinterStatus } from '../lib/kitchenPrinter';
import { useSettings } from '../lib/queries';

function Qr({ text, size = 180 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import('qrcode').then((m) => m.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })).then((s) => alive && setSvg(s));
    return () => {
      alive = false;
    };
  }, [text]);
  return <div className="qr-box" style={{ width: size, height: size }} aria-label={`QR code: ${text}`} role="img" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />;
}

/** Colocar os atendentes no celular e fazer os pedidos saírem na cozinha (tela ou impressora). */
export default function Phones() {
  const { can } = useAuth();
  const settings = useSettings();
  const width = settings.data?.printWidth ?? 80;
  const addr = useQuery({ queryKey: ['addresses'], queryFn: () => get<{ urls: string[] }>('/api/system/addresses') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<{ id: string; name: string; username: string; role: string; active: boolean }[]>('/api/users'), enabled: can('users.manage') });
  const [pick, setPick] = useState(0);
  if (addr.isLoading) return <Layout title="Celulares e cozinha"><Loading /></Layout>;
  const urls = addr.data?.urls ?? [];
  const base = urls[pick] ?? null;
  const local = /^https?:\/\/(localhost|127\.)/.test(window.location.origin);
  const waiters = (users.data ?? []).filter((u) => u.role === 'waiter' && u.active);

  return (
    <Layout title="Celulares e cozinha" actions={<Button icon={Printer} onClick={() => window.print()}>Imprimir esta página</Button>}>
      <div className="phones">
        <section className="card phones-qr">
          <h2 className="hstack" style={{ gap: 8 }}><Smartphone size={20} aria-hidden /> Celulares dos atendentes</h2>
          {!base ? (
            <Alert kind="warn">Este computador não está conectado a uma rede (Wi-Fi ou cabo). Conecte-o à rede da loja e recarregue a página.</Alert>
          ) : (
            <div className="qr-row">
              <div className="qr-card">
                <Qr text={`${base}/atendente`} size={200} />
                <b className="mono">{base}/atendente</b>
                <small className="muted">Atendentes: aponte a câmera do celular</small>
              </div>
              <ol className="steps">
                <li><Wifi size={16} aria-hidden /> Conecte o celular ao <b>Wi-Fi da loja</b> (o mesmo deste computador).</li>
                <li>Abra a <b>câmera</b> e aponte para o QR (ou digite o endereço no Chrome/Safari).</li>
                <li>Entre com o <b>usuário e a senha do atendente</b>.</li>
                <li>
                  Deixe o ícone na tela do celular: <b>Android</b> (Chrome): menu ⋮ → <i>Adicionar à tela inicial</i>.{' '}
                  <b>iPhone</b> (Safari): Compartilhar → <i>Adicionar à Tela de Início</i>.
                </li>
                <li>Teste: abra uma mesa, lance um item e toque em <b>Conferir e enviar</b>. O pedido aparece na cozinha.</li>
              </ol>
            </div>
          )}
          {urls.length > 1 && (
            <p className="no-print">
              <small className="muted">
                Este computador tem mais de uma rede. Se o celular não abrir, tente outro endereço:{' '}
                {urls.map((u, i) => (
                  <Button key={u} size="sm" variant={i === pick ? 'primary' : 'ghost'} onClick={() => setPick(i)}>{u.replace('http://', '')}</Button>
                ))}
              </small>
            </p>
          )}
          {!local && base && <Alert kind="info">Você está num aparelho da rede. O QR acima funciona em qualquer celular no mesmo Wi-Fi.</Alert>}
          <div className="no-print">
            <h3>Atendentes cadastrados</h3>
            {can('users.manage') ? (
              <>
                {waiters.length ? (
                  <p>{waiters.map((u) => `${u.name} (usuário: ${u.username})`).join(' · ')}</p>
                ) : (
                  <Alert kind="warn">Nenhum atendente cadastrado ainda.</Alert>
                )}
                <Link className="btn" to="/ajustes?aba=users">Cadastrar atendentes (Ajustes → Usuários, perfil “Atendente”)</Link>
              </>
            ) : (
              <p>O administrador cadastra cada atendente em <b>Ajustes → Usuários</b>, com o perfil <b>Atendente</b>.</p>
            )}
            <p><small className="muted">Cada atendente com o seu usuário: o caixa e a cozinha veem quem lançou cada pedido. Celular só lança e acompanha pedidos; receber é no caixa.</small></p>
          </div>
        </section>

        <section className="card no-print">
          <h2 className="hstack" style={{ gap: 8 }}><ChefHat size={20} aria-hidden /> Pedidos saindo na cozinha</h2>
          <p>Tudo o que os atendentes enviam vai para a cozinha na hora. Escolha uma ou as duas formas:</p>
          <div className="kopts">
            <KitchenPrinterBox width={width} />
            <div className="kopt">
              <h3>2. Tela (tablet ou celular na cozinha)</h3>
              {base ? (
                <div className="hstack" style={{ gap: 12, alignItems: 'center' }}>
                  <Qr text={`${base}/cozinha`} size={120} />
                  <div>
                    <b className="mono">{base}/cozinha</b>
                    <p><small>Entre com um usuário de perfil <b>Cozinha</b>. A tela mostra a fila na ordem de chegada, com som a cada pedido novo.</small></p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}

interface PrintersInfo {
  enabled: boolean;
  agent: boolean;
  kitchenPrinter: string;
  printers: string[];
  defaultPrinter: string | null;
  last: { ok: boolean; at: string; message: string } | null;
}

/**
 * Impressora da cozinha. Com o aplicativo da loja (Windows), escolhe-se a impressora pelo nome e a via da cozinha
 * sai nela (a nota continua na impressora padrão = caixa). Sem escolher, imprime pelo navegador na padrão.
 */
function KitchenPrinterBox({ width }: { width: number }) {
  const qc = useQueryClient();
  const ui = useUi();
  const { busy, go } = useAction();
  const printer = useKitchenPrinterStatus();
  const info = useQuery({ queryKey: ['printers'], queryFn: () => get<PrintersInfo>('/api/system/printers'), refetchInterval: 10_000 });
  const [pick, setPick] = useState<string | null>(null);
  const d = info.data;
  const chosen = d?.kitchenPrinter ?? '';
  const sel = pick ?? chosen;
  const save = (name: string) =>
    go(async () => {
      await post('/api/system/kitchen-printer', { name });
      await Promise.all([qc.invalidateQueries({ queryKey: ['printers'] }), qc.invalidateQueries({ queryKey: ['settings'] })]);
      setPick(null);
    }, { success: name ? `Via da cozinha vai sair em: ${name}` : 'Via da cozinha volta para a impressora padrão' });
  return (
    <div className="kopt">
      <h3>1. Impressora (papel)</h3>
      <p>Cada pedido enviado sai impresso na hora: número, mesa, itens, observações e atendente. Acréscimos saem como <b>ACRÉSCIMO</b>; alterações como <b>ALTERADO</b>; cancelados como <b>CANCELADO</b>.</p>
      {d?.enabled ? (
        <>
          <Field label="Impressora da cozinha" hint={d.agent ? `Nota do cliente sai na impressora padrão do Windows${d.defaultPrinter ? ` (${d.defaultPrinter})` : ''} — deixe a do caixa como padrão.` : undefined}>
            <select value={sel} onChange={(e) => setPick(e.target.value)}>
              <option value="">Mesma impressora do caixa (padrão do Windows)</option>
              {(d.printers.length ? d.printers : chosen ? [chosen] : []).map((p) => <option key={p} value={p}>{p}{p === d.defaultPrinter ? ' (padrão)' : ''}</option>)}
            </select>
          </Field>
          {!d.agent && <Alert kind="warn">O aplicativo Bar do Guto não respondeu ainda com a lista de impressoras. Abra o sistema pelo ícone do Bar do Guto neste computador e espere alguns segundos.</Alert>}
          <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" busy={busy} disabled={sel === chosen} onClick={() => save(sel)}>Usar esta impressora</Button>
            {chosen && <Button busy={busy} onClick={() => go(() => post('/api/system/printers/test', {}), { success: 'Teste enviado para a impressora da cozinha' })}>Imprimir teste na cozinha</Button>}
            {!chosen && <Button onClick={() => void printHtml(ticketHtml(testTicket(), 'novo', width))}>Imprimir teste</Button>}
          </div>
          {chosen ? (
            <div className={'kprint-state ' + (d.last ? (d.last.ok ? 'on' : 'err') : 'wait')} role="status">
              Via da cozinha → <b>{chosen}</b>
              {d.last && <small> · {d.last.ok ? 'última impressão OK' : 'ERRO'} {d.last.at ? `às ${new Date(d.last.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}{d.last.message ? ` — ${d.last.message}` : ''}</small>}
            </div>
          ) : (
            <BrowserPrintState printer={printer} />
          )}
        </>
      ) : (
        <>
          <BrowserPrintState printer={printer} />
          <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant={printer.on ? 'ghost' : 'primary'} icon={Printer} onClick={() => { setKitchenPrinting(!printer.on); ui.toast(printer.on ? 'Impressão da cozinha desligada neste computador' : 'Impressão da cozinha ligada', 'ok'); }}>
              {printer.on ? 'Desligar impressão aqui' : 'Ligar impressão neste computador'}
            </Button>
            <Button onClick={() => void printHtml(ticketHtml(testTicket(), 'novo', width))}>Imprimir teste</Button>
          </div>
          <small className="muted">Escolher uma impressora só para a cozinha é possível no aplicativo Bar do Guto (Windows). Aqui a via sai na impressora padrão.</small>
        </>
      )}
    </div>
  );
}

function BrowserPrintState({ printer }: { printer: ReturnType<typeof useKitchenPrinterStatus> }) {
  return (
    <div className={'kprint-state ' + (printer.on ? (printer.active ? 'on' : 'wait') : 'off')} role="status">
      {printer.on ? (printer.active ? 'Imprimindo na impressora padrão deste computador' : 'Ligada (outra janela deste computador está imprimindo)') : 'Impressão automática desligada neste computador'}
      {printer.last && <small> · último: {printer.last}</small>}
      {printer.error && <small className="err"> · {printer.error}</small>}
    </div>
  );
}
