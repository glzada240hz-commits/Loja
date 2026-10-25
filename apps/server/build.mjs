import { build } from 'esbuild';
import fs from 'node:fs';

await build({
  entryPoints: ['src/main.ts', 'src/db/migrate-cli.ts', 'src/db/seed-cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  // @guto/core é código-fonte TS do monorepo: entra no bundle
  alias: { '@guto/core': '../../packages/core/src/index.ts' },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
fs.rmSync('dist/migrations', { recursive: true, force: true });
fs.cpSync('migrations', 'dist/migrations', { recursive: true });
console.log('servidor compilado em dist/');
