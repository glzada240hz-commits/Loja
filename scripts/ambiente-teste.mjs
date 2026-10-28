// Ambiente de TESTES do Bar do Guto, sem instalar PostgreSQL:
//  - sobe um PostgreSQL embutido só para testes (pasta .teste/, porta 54329), separado de qualquer banco real;
//  - cria o banco "guto_teste" com dados FICTÍCIOS (cardápio demonstrativo e usuários de teste);
//  - inicia a aplicação (porta 3000) já com o dia e o caixa abertos;
//  - com --tunel, abre um endereço HTTPS público e gratuito (Cloudflare Quick Tunnel) para o celular.
// Uso:  node scripts/ambiente-teste.mjs [--tunel] [--zerar]
// No Windows, use o arquivo iniciar-teste.bat (dois cliques).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.teste');
const PG_DIR = path.join(DIR, 'pgdata');
const PG_PORT = 54329;
const APP_PORT = Number(process.env.PORT ?? 3000);
const ADMIN_PASSWORD = 'admin-teste-123';
const DB_URL = `postgres://guto:guto-teste@127.0.0.1:${PG_PORT}/guto_teste`;
const args = process.argv.slice(2);
const children = [];
let pg;
const pgLog = [];

const log = (msg) => console.log(`\x1b[33m[teste]\x1b[0m ${msg}`);

function exe(name) {
  const local = path.join(DIR, process.platform === 'win32' ? `${name}.exe` : name);
  if (fs.existsSync(local)) return local;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of process.platform === 'win32' ? ['.exe', ''] : ['']) {
      const p = path.join(dir, name + ext);
      if (dir && fs.existsSync(p)) return p;
    }
  }
  return null;
}

function run(cmd, cmdArgs, env, opts = {}) {
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, env, stdio: opts.stdio ?? 'inherit', shell: opts.shell ?? false });
  children.push(child);
  return child;
}

async function waitHealth(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Abre o túnel HTTPS gratuito (sem conta) e devolve o endereço https://....trycloudflare.com */
function startTunnel(bin) {
  return new Promise((resolve) => {
    const child = run(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${APP_PORT}`], process.env, { stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false;
    const onData = (buf) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
      if (m && !done) {
        done = true;
        resolve(m[0]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => !done && resolve(null));
    setTimeout(() => !done && resolve(null), 45000);
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/** Abre o dia operacional e o caixa (fundo de troco R$ 100,00) pela própria API, se ainda não estiverem abertos. */
async function prepareStore(base) {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'guto' },
    body: JSON.stringify({ username: 'gerente', password: 'demo1234' }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const h = { 'content-type': 'application/json', 'x-requested-with': 'guto', cookie };
  const day = await (await fetch(`${base}/api/day`, { headers: h })).json();
  if (!day.day) await fetch(`${base}/api/day/open`, { method: 'POST', headers: h, body: '{}' });
  if (!day.cash) await fetch(`${base}/api/cash/open`, { method: 'POST', headers: h, body: JSON.stringify({ openingCents: 10000 }) });
}

async function shutdown(code = 0) {
  log('Encerrando…');
  for (const c of children) c.kill();
  try {
    await pg?.stop();
  } catch {
    /* já parado */
  }
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('SIGHUP', () => void shutdown(0)); // Windows: janela do prompt fechada

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    sock.once('connect', () => (sock.destroy(), resolve(true)));
    sock.once('error', () => resolve(false));
  });
}

/** Desliga um PostgreSQL de testes que sobrou de uma execução anterior (janela fechada à força). */
async function stopLeftover() {
  if (!(await portInUse(PG_PORT))) return;
  const pidFile = path.join(PG_DIR, 'postmaster.pid');
  const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8').split(/\r?\n/)[0]) : NaN;
  if (pid > 0) {
    log('Desligando o PostgreSQL de testes que ficou da execução anterior…');
    try {
      process.kill(pid, 'SIGINT'); // desligamento rápido e seguro
    } catch {
      /* já terminou */
    }
    for (let i = 0; i < 60 && (await portInUse(PG_PORT)); i++) await new Promise((r) => setTimeout(r, 500));
  }
  if (await portInUse(PG_PORT)) throw new Error(`A porta ${PG_PORT} está ocupada por outro programa. Feche-o (ou reinicie o computador) e tente de novo.`);
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'apps/server/dist/main.js')) || !fs.existsSync(path.join(ROOT, 'apps/web/dist/index.html'))) {
    log('Compilando o sistema (primeira vez)…');
    await new Promise((res, rej) => run('npm', ['run', 'build'], process.env, { stdio: 'inherit', shell: true }).on('exit', (c) => (c ? rej(new Error('falha no build')) : res())).on('error', rej));
  }
  await stopLeftover();
  if (args.includes('--zerar') && fs.existsSync(DIR)) {
    log('Apagando dados de teste anteriores…');
    fs.rmSync(PG_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIR, { recursive: true });

  pg = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    user: 'guto',
    password: 'guto-teste',
    port: PG_PORT,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'], // igual em Windows e Linux (sem depender do idioma do sistema)
    createPostgresUser: process.platform !== 'win32' && process.getuid?.() === 0,
    // Mensagens do PostgreSQL só aparecem se algo der errado (ou com GUTO_DEBUG=1).
    onLog: (m) => (process.env.GUTO_DEBUG ? process.stdout.write(m) : pgLog.push(String(m))),
    onError: (m) => pgLog.push(String(m)),
  });
  const fresh = !fs.existsSync(path.join(PG_DIR, 'PG_VERSION'));
  if (fresh) {
    log('Criando banco de testes separado em .teste/pgdata …');
    await pg.initialise();
  }
  await pg.start().catch(() => {
    throw new Error(`Não foi possível iniciar o PostgreSQL de testes na porta ${PG_PORT}.`);
  });
  if (fresh) await pg.createDatabase('guto_teste');
  log(`PostgreSQL de testes rodando na porta ${PG_PORT}.`);

  let publicUrl = `http://localhost:${APP_PORT}`;
  if (args.includes('--tunel')) {
    const bin = exe('cloudflared');
    if (!bin) log('cloudflared não encontrado: o link HTTPS público não será criado (veja docs/TESTE-WINDOWS.md).');
    else {
      log('Abrindo endereço HTTPS público gratuito (Cloudflare)…');
      const url = await startTunnel(bin);
      if (url) publicUrl = url;
      else log('Não foi possível abrir o túnel agora. O sistema continua acessível neste computador e na rede Wi-Fi.');
    }
  }

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(APP_PORT),
    HOST: '0.0.0.0',
    DATABASE_URL: DB_URL,
    PUBLIC_BASE_URL: publicUrl,
    WEB_DIST: path.join(ROOT, 'apps/web/dist'),
    UPLOAD_DIR: path.join(DIR, 'uploads'),
    MIGRATIONS_DIR: path.join(ROOT, 'apps/server/migrations'),
    SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
    WHATSAPP_MODE: 'demo',
    LOG_LEVEL: 'warn',
  };
  log('Aplicando estrutura do banco e dados fictícios…');
  await new Promise((res, rej) => run(process.execPath, ['apps/server/dist/db/seed-cli.js'], env, { stdio: 'ignore' }).on('exit', (c) => (c ? rej(new Error('falha no seed')) : res())));
  run(process.execPath, ['apps/server/dist/main.js'], env);
  if (!(await waitHealth(`http://127.0.0.1:${APP_PORT}/api/health`))) {
    log('A aplicação não respondeu. Veja as mensagens acima.');
    return shutdown(1);
  }
  await prepareStore(`http://127.0.0.1:${APP_PORT}`);

  const lan = lanAddresses();
  console.log(`
==================================================================
  BAR DO GUTO — AMBIENTE DE TESTES (dados fictícios)
==================================================================
  Neste computador:   http://localhost:${APP_PORT}
${publicUrl.startsWith('https://') ? `  Celular e qualquer aparelho (HTTPS):\n      ${publicUrl}\n` : ''}${lan.length ? `  Celular na mesma rede Wi-Fi (sem HTTPS):\n${lan.map((ip) => `      http://${ip}:${APP_PORT}`).join('\n')}\n` : ''}
  Usuários de teste (senha: demo1234)
      caixa       → Caixa (PDV, mesas, receber e fechar contas)
      atendente1  → App do atendente (celular)
      atendente2  → App do atendente (outro celular)
      cozinha     → Painel da cozinha
      gerente     → Gerente (autoriza descontos e cancelamentos)
      admin       → senha: ${ADMIN_PASSWORD}
  Cardápio digital do cliente: <endereço>/c

  O dia e o caixa já estão abertos (fundo de troco R$ 100,00).
  Para encerrar: feche esta janela ou pressione Ctrl+C.
==================================================================
`);
}

main().catch(async (e) => {
  if (pgLog.length) console.error(pgLog.slice(-20).join(''));
  console.error(e);
  await shutdown(1);
});
