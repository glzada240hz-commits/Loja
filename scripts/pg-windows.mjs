// PostgreSQL embutido no Windows via pg_ctl.
// O postgres.exe se recusa a rodar com privilégios de administrador elevados ("como administrador",
// alguns computadores de loja e os robôs de teste do GitHub). O pg_ctl contorna isso de forma oficial:
// inicia o servidor com um token de privilégios reduzidos.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

async function bin() {
  const m = await import('@embedded-postgres/windows-x64');
  return m.pg_ctl.endsWith('.exe') ? m.pg_ctl : m.pg_ctl + '.exe';
}

/** Inicia e espera ficar pronto. Lança erro com o final do log do PostgreSQL se não subir. */
export async function startPg(dataDir, port) {
  const pgCtl = await bin();
  const logFile = path.join(dataDir, '..', 'postgres.log');
  // stdio 'ignore': o postgres iniciado pelo pg_ctl herdaria os canais de saída e o pg_ctl nunca "terminaria"
  // para quem o chamou; as mensagens vão para o arquivo de log
  const r = spawnSync(pgCtl, ['start', '-D', dataDir, '-l', logFile, '-w', '-t', '90', '-o', `-p ${port} -c listen_addresses=127.0.0.1`], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 120_000,
    env: { ...process.env, LC_MESSAGES: 'en_US.UTF-8' },
  });
  if (r.status !== 0) {
    const tail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-15).join('\n') : '';
    throw Object.assign(new Error(`O banco de dados não iniciou (pg_ctl ${r.status ?? r.error?.message}).\n${tail}`), { friendly: true });
  }
}

/** Desliga com segurança (modo rápido: termina conexões e grava tudo). Ignora se já estiver parado. */
export async function stopPg(dataDir) {
  if (!fs.existsSync(path.join(dataDir, 'postmaster.pid'))) return;
  const pgCtl = await bin();
  spawnSync(pgCtl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '60'], { windowsHide: true, stdio: 'ignore', timeout: 90_000 });
}

/** Cria o banco (a função da biblioteca exige que ela mesma tenha iniciado o servidor). */
export async function createDatabase(port, user, password, name) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ host: '127.0.0.1', port, user, password, database: 'postgres' });
  await c.connect();
  try {
    await c.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  } finally {
    await c.end();
  }
}
