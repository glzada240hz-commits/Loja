/**
 * Cardápio digital na internet (modo loja), pelo computador da loja.
 *
 * 1. "Porteiro" (gateway) em 127.0.0.1:PUBLIC_PORT: só deixa passar o cardápio digital (/c), o acompanhamento do
 *    pedido e os arquivos da interface. Login, caixa, relatórios e toda a API interna ficam BLOQUEADOS para quem
 *    vem de fora. Cookies não passam (ninguém de fora usa sessão da equipe).
 * 2. Túnel (cloudflared, "quick tunnel" gratuito, sem conta): publica o porteiro num endereço https
 *    *.trycloudflare.com. Só funciona com o computador ligado e o sistema aberto. O endereço MUDA quando o túnel
 *    reinicia (limitação do túnel gratuito; endereço fixo exige domínio próprio).
 * Ligado/desligado pelo dono em Ajustes (publicMenuOnline).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { Deps } from '../lib/context.js';
import { getSettings } from './settings.js';

const STATIC = /^\/(assets|icons|uploads)\/[\w.\-/%]+$/;
const FILES = new Set(['/manifest.webmanifest', '/sw.js', '/version.json', '/logo-nota.png', '/favicon.ico', '/robots.txt']);

/** O que pode ser acessado de fora da loja (função pura; testada). */
export function publicAllowed(method: string, rawUrl: string): 'allow' | 'home' | 'deny' {
  const url = rawUrl.split('?')[0]!;
  if (url.includes('..')) return 'deny';
  if (method === 'GET' || method === 'HEAD') {
    if (url === '/' || url === '/login') return 'home';
    if (url === '/c' || url.startsWith('/c/')) return 'allow';
    if (/^\/workbox-[\w-]+\.js$/.test(url) || FILES.has(url) || STATIC.test(url)) return 'allow';
    if (url === '/api/public/menu' || url === '/api/public/brand' || /^\/api\/public\/orders\/[\w-]+$/.test(url)) return 'allow';
    return 'deny';
  }
  if (method === 'POST' && url === '/api/public/orders') return 'allow';
  if (method === 'OPTIONS') return 'deny';
  return 'deny';
}

export function startPublicGateway(publicPort: number, appPort: number, log: { warn: (o: unknown, m?: string) => void }) {
  const server = http.createServer((req, res) => {
    const verdict = publicAllowed(req.method ?? 'GET', req.url ?? '/');
    if (verdict === 'home') {
      res.writeHead(302, { location: '/c' });
      return res.end();
    }
    if (verdict === 'deny') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Página não encontrada. Cardápio: /c');
    }
    const headers = { ...req.headers };
    delete headers.cookie; // sessão da equipe nunca vem de fora
    delete headers['x-forwarded-for'];
    const ip = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '');
    headers['x-forwarded-for'] = ip; // limite de pedidos por cliente (não por túnel)
    headers['x-guto-public'] = '1';
    headers.host = `127.0.0.1:${appPort}`;
    const up = http.request({ host: '127.0.0.1', port: appPort, method: req.method, path: req.url, headers }, (r) => {
      const h = { ...r.headers };
      delete h['set-cookie'];
      res.writeHead(r.statusCode ?? 502, h);
      r.pipe(res);
    });
    up.on('error', (e) => {
      log.warn({ err: e }, 'cardápio na internet: falha ao repassar');
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Sistema da loja indisponível no momento.');
    });
    req.pipe(up);
  });
  server.listen(publicPort, '127.0.0.1');
  return server;
}

export interface TunnelState {
  enabled: boolean;
  available: boolean;
  status: 'off' | 'starting' | 'online' | 'error';
  url: string | null;
  error: string | null;
  since: string | null;
}

/** Liga/desliga o túnel conforme Ajustes; reinicia sozinho se cair. */
export function startTunnelManager(deps: Deps, opts: { cloudflared?: string; publicPort: number; log: { warn: (o: unknown, m?: string) => void } }) {
  const available = !!opts.cloudflared && fs.existsSync(opts.cloudflared);
  const state: TunnelState = { enabled: false, available, status: 'off', url: null, error: null, since: null };
  let child: ChildProcess | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const launch = () => {
    if (!available || child || stopped) return;
    state.status = 'starting';
    state.error = null;
    state.url = null;
    const c = spawn(opts.cloudflared!, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${opts.publicPort}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child = c;
    const onData = (d: Buffer) => {
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && state.url !== m[0]) {
        state.url = m[0];
        state.status = 'online';
        state.since = new Date().toISOString();
        deps.bus.publish({ type: 'menu.changed' }); // telas atualizam o link
      }
    };
    c.stdout?.on('data', onData);
    c.stderr?.on('data', onData);
    c.on('error', (e) => {
      state.status = 'error';
      state.error = e.message;
    });
    c.on('exit', (code) => {
      child = null;
      if (stopped || !state.enabled) {
        state.status = 'off';
        state.url = null;
        return;
      }
      state.status = 'error';
      state.url = null;
      state.error = `túnel parou (código ${code}); tentando de novo`;
      retry = setTimeout(launch, 15_000);
    });
  };
  const kill = () => {
    if (retry) clearTimeout(retry);
    retry = null;
    child?.kill();
    child = null;
    state.status = 'off';
    state.url = null;
  };
  const sync = async () => {
    try {
      const s = await getSettings(deps.db);
      state.enabled = s.publicMenuOnline;
      if (s.publicMenuOnline) launch();
      else if (child || state.status !== 'off') kill();
    } catch (e) {
      opts.log.warn({ err: e }, 'cardápio na internet: falha ao ler ajustes');
    }
  };
  const onEvent = (ev: { type: string }) => ev.type === 'menu.changed' && void sync();
  deps.bus.on('event', onEvent);
  const timer = setInterval(() => void sync(), 30_000);
  void sync();
  return {
    state,
    sync,
    stop() {
      stopped = true;
      deps.bus.off('event', onEvent);
      clearInterval(timer);
      kill();
    },
  };
}

/** Túnel em execução (modo loja); null fora dele. */
export const tunnelRef: { current: ReturnType<typeof startTunnelManager> | null } = { current: null };
