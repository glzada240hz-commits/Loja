import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pkg from './package.json' with { type: 'json' };

// identificação do build (Ajuda → Sobre) e /version.json para comparar com a versão aberta no aparelho
function commit() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'sem-git';
  }
}
/** Impressão digital do código (interface, regras e servidor): igual em qualquer máquina (ZIP ou Git, CRLF ou LF). */
function sourceHash() {
  const h = crypto.createHash('sha256');
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else {
        h.update(path.relative(__dirname, p).split(path.sep).join('/'));
        h.update(fs.readFileSync(p).toString('latin1').replace(/\r\n/g, '\n'));
      }
    }
  };
  walk(path.join(__dirname, 'src'));
  walk(path.join(__dirname, '../../packages/core/src'));
  walk(path.join(__dirname, '../server/src'));
  return h.digest('hex').slice(0, 8);
}
const BUILD = { version: pkg.version, commit: commit(), builtAt: new Date().toISOString(), code: sourceHash() };
const buildId = `${BUILD.version}+${BUILD.code}`;

export default defineConfig({
  define: { __BUILD__: JSON.stringify({ ...BUILD, id: buildId }) },
  plugins: [
    react(),
    {
      name: 'guto-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ ...BUILD, id: buildId }) });
      },
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'Bar do Guto — Gestão',
        short_name: 'Bar do Guto',
        description: 'PDV, cozinha, entregas, caixa e cardápio digital do Bar do Guto',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        background_color: '#f7f7f5',
        theme_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // somente a "casca" do app fica em cache; dados SEMPRE vêm do servidor (sem modo offline de pedidos)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000', '/uploads': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
