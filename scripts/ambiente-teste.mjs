// Ambiente de TESTES do Bar do Guto, sem instalar PostgreSQL:
//  - confere a versão do Node, instala dependências quando o package-lock muda e RECOMPILA quando o
//    código muda (um build antigo não impede a atualização);
//  - sobe um PostgreSQL embutido só para testes (porta 54329), separado de qualquer banco real;
//  - guarda os dados FORA da pasta do projeto no Windows (%LOCALAPPDATA%\BarDoGuto\teste), para que
//    baixar uma versão nova não apague nada;
//  - impede abrir duas vezes; zerar os dados é uma ação separada (--zerar, pede confirmação);
//  - inicia a aplicação (porta 3000) já com o dia e o caixa abertos;
//  - com --tunel, abre um endereço HTTPS público e gratuito (Cloudflare Quick Tunnel) para o celular.
// Uso:  node scripts/ambiente-teste.mjs [--tunel] [--zerar [--sim]] [--sem-iniciar]
// No Windows, use iniciar-teste.bat (dois cliques) e zerar-dados-teste.bat.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const DIR = process.env.GUTO_TESTE_DIR ?? (WIN ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'BarDoGuto', 'teste') : path.join(ROOT, '.teste'));
const PG_DIR = path.join(DIR, 'pgdata');
const LOCK = path.join(DIR, 'em-uso.lock');
const PG_PORT = 54329;
const APP_PORT = Number(process.env.PORT ?? 3000);
const ADMIN_PASSWORD = 'admin-teste-123';
const DB_URL = `postgres://guto:guto-teste@127.0.0.1:${PG_PORT}/guto_teste`;
const args = process.argv.slice(2);
const children = [];
let pg;
const pgLog = [];

const log = (msg) => console.log(`\x1b[33m[teste]\x1b[0m ${msg}`);
const fail = (msg) => {
  const e = new Error(msg);
  e.friendly = true;
  return e;
};

// ---------------------------------------------------------------- verificações

function checkNode() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  const ok = maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19);
  if (!ok) throw fail(`Node.js ${process.versions.node} é antigo demais. Instale a versão LTS (22 ou mais nova) em https://nodejs.org e rode de novo.`);
}

/** Impede duas cópias rodando ao mesmo tempo (duplicaria processos e brigaria pelo banco). */
function takeLock() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = pid !== process.pid;
    } catch {
      alive = false;
    }
    if (alive) throw fail(`O sistema de testes já está aberto em outra janela (processo ${pid}). Use aquela janela, ou feche-a antes de abrir de novo.`);
  }
  fs.writeFileSync(LOCK, String(process.pid));
}
function releaseLock() {
  try {
    if (fs.existsSync(LOCK) && Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.rmSync(LOCK);
  } catch {
    /* ignora */
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    sock.once('connect', () => (sock.destroy(), resolve(true)));
    sock.once('error', () => resolve(false));
  });
}

function hashFiles(paths) {
  const h = crypto.createHash('sha256');
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) if (f !== 'node_modules' && f !== 'dist' && !f.startsWith('.')) walk(path.join(p, f));
    } else {
      h.update(path.relative(ROOT, p).split(path.sep).join('/'));
      // ignora diferença de fim de linha (ZIP do GitHub x git com autocrlf)
      h.update(fs.readFileSync(p).toString('latin1').replace(/\r\n/g, '\n'));
    }
  };
  for (const p of paths) walk(path.join(ROOT, p));
  return h.digest('hex');
}

function npm(cmdArgs, what) {
  log(what);
  // npm no Windows é um .cmd: precisa de shell
  const r = spawnSync('npm', cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw fail(`Falhou: npm ${cmdArgs.join(' ')}. Verifique a conexão com a internet e as mensagens acima.`);
}

/** Instala dependências quando faltam ou quando o package-lock mudou (versão nova baixada). */
function ensureDeps() {
  const stampFile = path.join(ROOT, 'node_modules', '.guto-deps');
  const want = hashFiles(['package-lock.json']);
  const have = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8') : '';
  if (have === want && fs.existsSync(path.join(ROOT, 'node_modules', 'embedded-postgres'))) return;
  npm(['install', '--no-audit', '--no-fund'], have ? 'Versão nova detectada: atualizando dependências…' : 'Instalando dependências (primeira vez, pode levar alguns minutos)…');
  fs.writeFileSync(stampFile, want);
}

const BUILD_INPUTS = ['package-lock.json', 'packages/core/src', 'apps/server/src', 'apps/server/migrations', 'apps/server/build.mjs', 'apps/web/src', 'apps/web/public', 'apps/web/index.html', 'apps/web/vite.config.ts'];

/** Recompila quando qualquer arquivo de código mudou desde o último build. */
function ensureBuild() {
  const stampFile = path.join(ROOT, 'apps', 'server', 'dist', '.guto-build');
  const want = hashFiles(BUILD_INPUTS);
  const built = fs.existsSync(path.join(ROOT, 'apps/server/dist/main.js')) && fs.existsSync(path.join(ROOT, 'apps/web/dist/index.html'));
  const have = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8') : '';
  if (built && have === want) return;
  npm(['run', 'build'], built ? 'O código mudou: recompilando o sistema…' : 'Compilando o sistema (primeira vez)…');
  fs.writeFileSync(stampFile, want);
}

/** Versões antigas guardavam os dados em <projeto>/.teste; traz para a pasta nova uma única vez. */
function migrateOldData() {
  const old = path.join(ROOT, '.teste', 'pgdata');
  if (!WIN || process.env.GUTO_TESTE_DIR || !fs.existsSync(path.join(old, 'PG_VERSION')) || fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))) return;
  log(`Copiando dados de teste da versão anterior para ${DIR} …`);
  fs.cpSync(old, PG_DIR, { recursive: true });
  fs.rmSync(path.join(PG_DIR, 'postmaster.pid'), { force: true });
}

// ---------------------------------------------------------------- PostgreSQL

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
  if (await portInUse(PG_PORT)) throw fail(`A porta ${PG_PORT} está ocupada por outro programa. Feche-o (ou reinicie o computador) e tente de novo.`);
}

async function confirmReset() {
  if (args.includes('--sim')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`\nIsto APAGA todos os pedidos e dados do ambiente de TESTES em:\n  ${PG_DIR}\nDigite ZERAR para confirmar: `);
  rl.close();
  return a.trim().toUpperCase() === 'ZERAR';
}

// ---------------------------------------------------------------- túnel HTTPS

function exe(name) {
  for (const dir of [DIR, path.join(ROOT, '.teste')]) {
    const local = path.join(dir, WIN ? `${name}.exe` : name);
    if (fs.existsSync(local)) return local;
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of WIN ? ['.exe', ''] : ['']) {
      const p = path.join(dir, name + ext);
      if (dir && fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** Baixa o cloudflared oficial (gratuito) para a pasta de dados de teste, se ainda não houver. Só Windows. */
async function downloadCloudflared() {
  if (!WIN) return null;
  const dest = path.join(DIR, 'cloudflared.exe');
  const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  log('Baixando o cloudflared (gratuito, da Cloudflare) para criar o link HTTPS…');
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    fs.writeFileSync(dest + '.part', Buffer.from(await r.arrayBuffer()));
    fs.renameSync(dest + '.part', dest);
    return dest;
  } catch (e) {
    log(`Não foi possível baixar o cloudflared (${e.message}). Veja docs/TESTE-WINDOWS.md, seção "Se algo der errado".`);
    return null;
  }
}

function run(cmd, cmdArgs, env, opts = {}) {
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, env, stdio: opts.stdio ?? 'inherit', shell: false });
  children.push(child);
  return child;
}

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

// ---------------------------------------------------------------- aplicação

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

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (pg) log('Encerrando… (os dados de teste ficam guardados)');
  for (const c of children) c.kill();
  try {
    await pg?.stop();
  } catch {
    /* já parado */
  }
  releaseLock();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('SIGHUP', () => void shutdown(0)); // Windows: janela do prompt fechada

async function main() {
  checkNode();
  takeLock();
  ensureDeps();
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  migrateOldData();
  await stopLeftover();
  if (args.includes('--zerar')) {
    if (!(await confirmReset())) {
      log('Nada foi apagado.');
      return shutdown(0);
    }
    fs.rmSync(PG_DIR, { recursive: true, force: true });
    log('Dados de teste apagados. Na próxima vez que iniciar, o banco é recriado com os dados fictícios.');
  }
  if (args.includes('--sem-iniciar')) return shutdown(0);
  ensureBuild();

  pg = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    user: 'guto',
    password: 'guto-teste',
    port: PG_PORT,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'], // igual em Windows e Linux (sem depender do idioma do sistema)
    createPostgresUser: !WIN && process.getuid?.() === 0,
    // Mensagens do PostgreSQL só aparecem se algo der errado (ou com GUTO_DEBUG=1).
    onLog: (m) => (process.env.GUTO_DEBUG ? process.stdout.write(m) : pgLog.push(String(m))),
    onError: (m) => pgLog.push(String(m)),
  });
  const fresh = !fs.existsSync(path.join(PG_DIR, 'PG_VERSION'));
  if (fresh) {
    log(`Criando banco de testes separado em ${PG_DIR} …`);
    await pg.initialise();
  }
  await pg.start().catch(() => {
    throw fail(`Não foi possível iniciar o PostgreSQL de testes na porta ${PG_PORT}.`);
  });
  if (fresh) await pg.createDatabase('guto_teste');
  log(`PostgreSQL de testes rodando na porta ${PG_PORT}.`);

  if (await portInUse(APP_PORT)) throw fail(`A porta ${APP_PORT} já está em uso por outro programa. Feche-o ou use outra porta (no Prompt: set PORT=3001).`);

  let publicUrl = `http://localhost:${APP_PORT}`;
  if (args.includes('--tunel')) {
    const bin = exe('cloudflared') ?? (await downloadCloudflared());
    if (!bin) log('Sem cloudflared: o link HTTPS público não será criado. O sistema funciona neste computador e no Wi-Fi.');
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
  log('Aplicando estrutura do banco (migrations) e dados fictícios…');
  await new Promise((res, rej) =>
    run(process.execPath, ['apps/server/dist/db/seed-cli.js'], env, { stdio: 'inherit' }).on('exit', (c) => (c ? rej(fail('Falha ao preparar o banco de testes (veja as mensagens acima).')) : res())),
  );
  const server = run(process.execPath, ['apps/server/dist/main.js'], env);
  server.on('exit', (c) => {
    if (!stopping) {
      log(`A aplicação parou inesperadamente (código ${c}). Veja as mensagens acima.`);
      void shutdown(1);
    }
  });
  if (!(await waitHealth(`http://127.0.0.1:${APP_PORT}/api/health`))) throw fail('A aplicação não respondeu. Veja as mensagens acima.');
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
  Dados de teste guardados em: ${DIR}
  Para encerrar: feche esta janela ou pressione Ctrl+C.
==================================================================
`);
}

main().catch(async (e) => {
  if (pgLog.length && !e.friendly) console.error(pgLog.slice(-20).join(''));
  console.error(`\n\x1b[31m[ERRO]\x1b[0m ${e.friendly ? e.message : (e.stack ?? e)}\n`);
  await shutdown(1);
});
