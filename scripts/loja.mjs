// Bar do Guto — modo LOJA (uso real), para o computador do caixa.
//  - banco de dados próprio da loja (PostgreSQL embutido, porta 54330), separado do ambiente de testes;
//  - sem usuários de demonstração; a senha do administrador é criada na primeira abertura;
//  - cópia de segurança automática do banco uma vez por dia (antes de iniciar), mantendo as 14 últimas;
//  - não abre duas vezes; fechar a janela encerra tudo com segurança.
// Uso: o aplicativo BarDoGuto.exe (Windows) executa este script escondido com --gui; também roda direto:
//      node scripts/loja.mjs
// Opções: --porta 3000  --dados <pasta>  --sem-navegador  --backup-agora  --exemplo
//         --nao-interativo --senha-admin <senha>   (só para instalação automatizada/testes)
//         --gui   modo usado pelo aplicativo do Windows: sem perguntas no terminal (a senha da primeira abertura
//                 chega pela variável GUTO_SENHA_ADMIN, nunca por argumento), linhas GUTO_PRONTO/GUTO_ERRO
//                 para o aplicativo e encerramento seguro quando ele envia "sair" ou fecha a entrada.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createDatabase, startPg, stopPg } from './pg-windows.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DIR = path.resolve(opt('--dados') ?? process.env.GUTO_LOJA_DIR ?? (WIN ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'BarDoGuto', 'loja') : path.join(os.homedir(), '.bar-do-guto', 'loja')));
const PG_DIR = path.join(DIR, 'banco');
const BACKUP_DIR = path.join(DIR, 'copias-de-seguranca');
const CONFIG = path.join(DIR, 'configuracao.json');
const LOCK = path.join(DIR, 'em-uso.lock');
const PG_PORT = 54330;
const APP_PORT = Number(opt('--porta') ?? process.env.PORT ?? 3000);
const KEEP_BACKUPS = 14;
const GUI = args.includes('--gui');
const ENV_PASSWORD = process.env.GUTO_SENHA_ADMIN;
delete process.env.GUTO_SENHA_ADMIN; // não repassa a senha aos processos filhos
const children = [];
const pgLog = [];
let pg;
let stopping = false;

const log = (msg) => console.log(`\x1b[33m[loja]\x1b[0m ${msg}`);
const fail = (msg) => Object.assign(new Error(msg), { friendly: true });

function checkNode() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (!(maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19))) throw fail(`Node.js ${process.versions.node} é antigo demais (o pacote da loja já traz o correto; reinstale).`);
  for (const p of ['apps/server/dist/main.js', 'apps/web/dist/index.html', 'node_modules/embedded-postgres']) {
    if (!fs.existsSync(path.join(ROOT, p))) throw fail(`Arquivo do sistema ausente: ${p}. Reinstale o Bar do Guto.`);
  }
}

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
    if (alive) throw fail(`O Bar do Guto já está aberto em outra janela (processo ${pid}). Use aquela janela.`);
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
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });
}

/** Pergunta no terminal; com `hidden`, não mostra o que é digitado (senha). */
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
        else if (s !== '\r\n' && s !== '\n') rl.output.write('*');
        else rl.output.write(s);
      };
    }
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(a.trim());
    });
  });
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    return null;
  }
}

/** Primeira abertura: senha do administrador e (opcional) cardápio de exemplo. A senha não é guardada. */
async function firstRun() {
  const pw = ENV_PASSWORD ?? (args.includes('--nao-interativo') ? opt('--senha-admin') : undefined);
  if (pw !== undefined || GUI || args.includes('--nao-interativo')) {
    if (!pw || pw.length < 8) throw fail('A senha do administrador precisa ter pelo menos 8 caracteres.');
    return { adminPassword: pw, example: args.includes('--exemplo') };
  }
  console.log(`
==================================================================
  BAR DO GUTO — PRIMEIRA ABERTURA NESTE COMPUTADOR
==================================================================
  Vamos criar o usuário "admin" (dono/gerente). Guarde a senha:
  sem ela não é possível entrar no sistema.
`);
  for (;;) {
    const a = await ask('  Crie a senha do admin (mínimo 8 caracteres): ', true);
    if (a.length < 8) {
      console.log('  A senha precisa ter pelo menos 8 caracteres.\n');
      continue;
    }
    const b = await ask('  Digite a senha de novo: ', true);
    if (a !== b) {
      console.log('  As senhas não conferem. Tente de novo.\n');
      continue;
    }
    const ex = await ask('\n  Carregar o cardápio de exemplo (X-Burguer, X-Bacon…, preços DEMONSTRATIVOS a revisar)? (S/N): ');
    return { adminPassword: a, example: /^s/i.test(ex) };
  }
}

/** Cópia do banco com o PostgreSQL parado (consistente). Uma por dia; mantém as 14 mais recentes. */
function backup(force = false) {
  if (!fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date()).replace(/[ :]/g, '-');
  const today = stamp.slice(0, 10);
  const existing = fs.readdirSync(BACKUP_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}/.test(f)).sort();
  if (!force && existing.some((f) => f.startsWith(today))) return;
  const dest = path.join(BACKUP_DIR, stamp);
  log(`Fazendo a cópia de segurança do dia em ${dest} …`);
  fs.cpSync(PG_DIR, dest, { recursive: true, filter: (src) => !src.endsWith('postmaster.pid') });
  for (const old of existing.concat(path.basename(dest)).sort().slice(0, -KEEP_BACKUPS)) fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
}

async function stopLeftover() {
  if (!(await portInUse(PG_PORT))) return;
  if (WIN) await stopPg(PG_DIR).catch(() => undefined);
  if (!(await portInUse(PG_PORT))) return;
  const pidFile = path.join(PG_DIR, 'postmaster.pid');
  const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8').split(/\r?\n/)[0]) : NaN;
  if (pid > 0) {
    log('Encerrando o banco que ficou aberto da última vez…');
    try {
      process.kill(pid, 'SIGINT');
    } catch {
      /* já terminou */
    }
    for (let i = 0; i < 60 && (await portInUse(PG_PORT)); i++) await new Promise((r) => setTimeout(r, 500));
  }
  if (await portInUse(PG_PORT)) throw fail(`A porta ${PG_PORT} está ocupada por outro programa. Reinicie o computador e tente de novo.`);
}

function run(cmd, cmdArgs, env, stdio = 'inherit') {
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, env, stdio });
  children.push(child);
  return child;
}
const runToEnd = (cmd, cmdArgs, env, what) =>
  new Promise((res, rej) => run(cmd, cmdArgs, env).on('exit', (c) => (c ? rej(fail(`${what} falhou (veja as mensagens acima).`)) : res())));

async function waitHealth(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const lanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !/^169\.254\./.test(i.address))
    .map((i) => i.address);

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (pg) log('Encerrando com segurança… (os dados ficam guardados)');
  for (const c of children) c.kill();
  try {
    if (WIN && pg) await stopPg(PG_DIR);
    else await pg?.stop();
  } catch {
    /* já parado */
  }
  releaseLock();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('SIGHUP', () => void shutdown(0)); // janela fechada no Windows
if (GUI) {
  // o aplicativo pede o encerramento escrevendo "sair"; se ele fechar (ou cair), a entrada termina
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => /sair/.test(d) && void shutdown(0));
  process.stdin.on('end', () => void shutdown(0));
  process.stdin.on('error', () => void shutdown(0));
}
/** Mensagem para o aplicativo do Windows (uma linha, em base64 para aceitar acentos e quebras de linha). */
const toApp = (kind, text) => GUI && console.log(`${kind} ${Buffer.from(text, 'utf8').toString('base64')}`);

async function main() {
  checkNode();
  takeLock();
  await stopLeftover();
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  let cfg = readConfig();
  const fresh = !fs.existsSync(path.join(PG_DIR, 'PG_VERSION'));
  let setup = null;
  if (fresh) {
    setup = await firstRun();
    cfg = { dbPassword: crypto.randomBytes(18).toString('base64url'), createdAt: new Date().toISOString() };
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  } else if (!cfg?.dbPassword) {
    throw fail(`Configuração da loja não encontrada em ${CONFIG}. Restaure a pasta de dados ou fale com o suporte.`);
  }
  backup(args.includes('--backup-agora'));

  pg = new EmbeddedPostgres({
    databaseDir: PG_DIR,
    user: 'guto',
    password: cfg.dbPassword,
    port: PG_PORT,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    createPostgresUser: !WIN && process.getuid?.() === 0,
    onLog: (m) => (process.env.GUTO_DEBUG ? process.stdout.write(m) : pgLog.push(String(m))),
    onError: (m) => pgLog.push(String(m)),
  });
  if (fresh) {
    log(`Criando o banco de dados da loja em ${PG_DIR} …`);
    await pg.initialise();
  }
  if (WIN) await startPg(PG_DIR, PG_PORT);
  else
    await pg.start().catch(() => {
      throw fail('Não foi possível iniciar o banco de dados da loja.\n' + pgLog.slice(-15).join(''));
    });
  if (fresh) await (WIN ? createDatabase(PG_PORT, 'guto', cfg.dbPassword, 'guto') : pg.createDatabase('guto'));
  if (await portInUse(APP_PORT)) throw fail(`A porta ${APP_PORT} já está em uso (talvez o ambiente de TESTES esteja aberto). Feche-o e abra de novo.`);

  const lan = lanAddresses();
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    COOKIE_SECURE: 'auto', // rede local da loja, sem HTTPS
    PORT: String(APP_PORT),
    HOST: '0.0.0.0',
    DATABASE_URL: `postgres://guto:${encodeURIComponent(cfg.dbPassword)}@127.0.0.1:${PG_PORT}/guto`,
    PUBLIC_BASE_URL: `http://${lan[0] ?? 'localhost'}:${APP_PORT}`,
    WEB_DIST: path.join(ROOT, 'apps/web/dist'),
    UPLOAD_DIR: path.join(DIR, 'fotos'),
    MIGRATIONS_DIR: path.join(ROOT, 'apps/server/dist/migrations'),
    WHATSAPP_MODE: 'demo',
    STORE_MODE: '1', // computador da loja imprime a cozinha sozinho (ver apps/web/src/lib/kitchenPrinter.ts)
    OFFICIAL_MENU_AUTO: '1', // cardápio do Bar do Guto já pronto na aba Cardápio (uma vez por versão)
    LOG_LEVEL: 'warn',
  };
  if (setup) {
    log('Preparando o banco (estrutura, usuário admin' + (setup.example ? ' e cardápio de exemplo' : '') + ')…');
    await runToEnd(process.execPath, ['apps/server/dist/db/seed-cli.js', ...(setup.example ? [] : ['--no-demo'])], { ...env, SEED_ADMIN_PASSWORD: setup.adminPassword }, 'Preparação do banco');
  } else {
    log('Atualizando a estrutura do banco, se preciso…');
    await runToEnd(process.execPath, ['apps/server/dist/db/migrate-cli.js'], env, 'Atualização do banco');
  }
  const server = run(process.execPath, ['apps/server/dist/main.js'], env);
  server.on('exit', (c) => {
    if (!stopping) {
      log(`O sistema parou inesperadamente (código ${c}). Feche esta janela e abra o Bar do Guto de novo.`);
      toApp('GUTO_ERRO', `O sistema parou inesperadamente (código ${c}). Abra o Bar do Guto de novo.`);
      void shutdown(1);
    }
  });
  if (!(await waitHealth(`http://127.0.0.1:${APP_PORT}/api/health`))) throw fail('O sistema não respondeu. Veja as mensagens acima.');

  const local = `http://localhost:${APP_PORT}`;
  if (GUI) {
    log(`Pronto: ${local} · rede local: ${lan.map((ip) => `http://${ip}:${APP_PORT}`).join(', ') || 'nenhuma'} · dados: ${DIR}`);
    toApp('GUTO_PRONTO', [local, lan.map((ip) => `http://${ip}:${APP_PORT}`).join(','), DIR, BACKUP_DIR].join('|'));
    return;
  }
  console.log(`
==================================================================
  BAR DO GUTO — LOJA (uso real)        NÃO FECHE ESTA JANELA
==================================================================
  Neste computador (caixa):  ${local}
${lan.length ? `  Celulares e tablets no Wi-Fi da loja:\n${lan.map((ip) => `      http://${ip}:${APP_PORT}`).join('\n')}\n` : ''}
  Usuário: admin  (senha criada na primeira abertura)
  Cadastre caixa, atendentes, cozinha e entregadores em Ajustes → Usuários.

  Dados da loja:          ${DIR}
  Cópias de segurança:    ${BACKUP_DIR}  (1 por dia, ${KEEP_BACKUPS} últimas)
  Copie essa pasta para um pendrive ou nuvem toda semana.

  Para encerrar no fim do dia: feche esta janela.
==================================================================
`);
  if (!args.includes('--sem-navegador') && WIN) spawn('cmd', ['/c', 'start', '', local], { detached: true, stdio: 'ignore' }).unref();
}

main().catch(async (e) => {
  if (pgLog.length && !e.friendly) console.error(pgLog.slice(-20).join(''));
  console.error(`\n\x1b[31m[ERRO]\x1b[0m ${e.friendly ? e.message : (e.stack ?? e)}\n`);
  toApp('GUTO_ERRO', e.friendly ? e.message : `Erro inesperado: ${e.message ?? e}`);
  await shutdown(1);
});
