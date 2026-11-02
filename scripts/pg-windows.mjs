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
  const r = spawnSync(pgCtl, ['start', '-D', dataDir, '-l', logFile, '-w', '-t', '90', '-o', `-p ${port} -c listen_addresses=127.0.0.1`], {
    windowsHide: true,
    encoding: 'utf8',
    env: { ...process.env, LC_MESSAGES: 'en_US.UTF-8' },
  });
  if (r.status !== 0) {
    const tail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-15).join('\n') : '';
    throw Object.assign(new Error(`O banco de dados não iniciou (pg_ctl ${r.status}).\n${r.stdout ?? ''}${r.stderr ?? ''}\n${tail}`), { friendly: true });
  }
}

/** Desliga com segurança (modo rápido: termina conexões e grava tudo). Ignora se já estiver parado. */
export async function stopPg(dataDir) {
  if (!fs.existsSync(path.join(dataDir, 'postmaster.pid'))) return;
  const pgCtl = await bin();
  spawnSync(pgCtl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '60'], { windowsHide: true });
}
