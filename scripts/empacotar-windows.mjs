// Monta o pacote do Bar do Guto para a loja (Windows): dist-windows/BarDoGuto/
//   app/      sistema compilado + dependências de produção (inclui o PostgreSQL embutido para Windows)
//   runtime/  node.exe (o mesmo Node que executa este script)
// Rode num Windows depois de `npm ci` e `npm run build` (o GitHub Actions faz isso; ver
// .github/workflows/pacote-windows.yml). O lançador BarDoGuto.exe e o instalador são criados pelo fluxo.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-windows', 'BarDoGuto');
const APP = path.join(OUT, 'app');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/dist/version.json'), 'utf8'));

for (const p of ['apps/server/dist/main.js', 'apps/web/dist/index.html']) if (!fs.existsSync(path.join(ROOT, p))) throw new Error(`Falta ${p}: rode npm run build antes.`);
fs.rmSync(path.join(ROOT, 'dist-windows'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'runtime'), { recursive: true });

const copy = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(APP, rel), { recursive: true });
copy('apps/server/dist');
copy('apps/web/dist');
copy('scripts/loja.mjs');
copy('scripts/pg-windows.mjs');

// dependências de produção com as MESMAS versões testadas (lidas de node_modules)
const installed = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
const serverDeps = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/server/package.json'), 'utf8')).dependencies).filter((d) => d !== '@guto/core');
const deps = Object.fromEntries([...serverDeps, 'embedded-postgres'].map((d) => [d, installed(d)]));
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({ name: 'bar-do-guto-loja', version: pkg.version, private: true, type: 'module', dependencies: deps }, null, 2));
console.log('Instalando dependências de produção:', deps);
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', { cwd: APP, stdio: 'inherit' });

fs.copyFileSync(process.execPath, path.join(OUT, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'));
fs.writeFileSync(path.join(OUT, 'versao.txt'), `Bar do Guto ${version.id} (commit ${version.commit}, compilado em ${version.builtAt})\r\n`);
fs.copyFileSync(path.join(ROOT, 'deploy/windows/LEIA-ME.txt'), path.join(OUT, 'LEIA-ME.txt'));
console.log(`Pacote montado em ${OUT} — versão ${version.id}`);
