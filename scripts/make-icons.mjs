// Gera ícones PNG do PWA a partir do SVG (usa o Chromium do Playwright).
import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('apps/web/public/icons/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0.12]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<body style="margin:0;background:#1c1917;display:grid;place-items:center;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body>`);
  await page.screenshot({ path: `apps/web/public/icons/${name}` });
}
await browser.close();
console.log('ícones gerados');
