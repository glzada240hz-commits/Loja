/* global crypto, localStorage, window */
// Grava as cenas do vídeo comercial a partir do sistema REAL (loja de demonstração preparada por cenario.mjs).
// Cada cena vira uma sequência de quadros JPEG (screencast do Chromium) + lista de durações para o ffmpeg.
// Uso: node scripts/video/gravar.mjs http://localhost:3200 <pasta-saida> [cena...]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const B = process.argv[2] ?? 'http://localhost:3200';
const OUT = path.resolve(process.argv[3] ?? 'video-cenas');
const ONLY = process.argv.slice(4);
const H = { 'x-requested-with': 'guto' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// cursor e toque visíveis (o Chromium sem tela não desenha o mouse)
const CURSOR = `
(() => {
  const css = '#vcur{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:none}' +
    '.vtap{position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(234,88,12,.35);border:2px solid rgba(234,88,12,.9);animation:vtap .55s ease-out forwards}' +
    '@keyframes vtap{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}';
  const add = () => {
    if (document.getElementById('vcur')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    if (!window.__touch) {
      const c = document.createElement('div'); c.id = 'vcur';
      c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.body.appendChild(c);
    }
  };
  const tap = (x, y) => { const d = document.createElement('div'); d.className = 'vtap'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 700); };
  addEventListener('mousemove', (e) => { const c = document.getElementById('vcur'); if (c) c.style.left = e.clientX + 'px', c.style.top = e.clientY + 'px'; }, true);
  addEventListener('pointerdown', (e) => tap(e.clientX, e.clientY), true);
  addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) tap(t.clientX, t.clientY); }, true);
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();`;

async function context(browser, kind, user, pass = 'demo1234') {
  const phone = kind === 'phone';
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' }
      : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  );
  await ctx.addInitScript(`window.__touch=${phone};` + CURSOR);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kds-sound', '0');
      localStorage.setItem('guto.kprint.on', '0');
    } catch {
      /* */
    }
  });
  if (user) {
    const r = await ctx.request.post(`${B}/api/auth/login`, { headers: H, data: { username: user, password: pass } });
    if (!r.ok()) throw new Error(`login ${user}`);
  }
  return ctx;
}

/** grava a cena: quadros JPEG com o tempo de cada um */
async function record(page, name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const f = `f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, f), Buffer.from(data, 'base64'));
    frames.push({ f, t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  const vp = page.viewportSize();
  const phone = vp.width < 500;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: phone ? 1170 : 1920, maxHeight: phone ? 2532 : 1080, everyNthFrame: 1 });
  const t0 = Date.now();
  await fn(page);
  await sleep(700);
  await cdp.send('Page.stopScreencast');
  const end = frames.length ? frames[0].t + (Date.now() - t0) / 1000 : 0;
  const lines = [];
  frames.forEach((fr, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    lines.push(`file '${fr.f}'`, `duration ${Math.max(0.02, next - fr.t).toFixed(3)}`);
  });
  if (frames.length) lines.push(`file '${frames.at(-1).f}'`);
  fs.writeFileSync(path.join(dir, 'lista.txt'), lines.join('\n') + '\n');
  console.log(`${name}: ${frames.length} quadros, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

/** move o cursor suavemente até o elemento e clica (ou toca, no celular) */
async function act(page, loc, { tap } = {}) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('sem posição');
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  if (tap) {
    await sleep(250);
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.move(x, y, { steps: 22 });
    await sleep(180);
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
  }
  await sleep(450);
}
const type = async (loc, text) => {
  await loc.click();
  await loc.pressSequentially(text, { delay: 55 });
  await sleep(250);
};
const smoothScroll = (page, y) => page.evaluate((dy) => window.scrollBy({ top: dy, behavior: 'smooth' }), y);

const browser = await chromium.launch();
const admin = await context(browser, 'desk', 'admin', 'admin-e2e-123');
const api = admin.request;
const menu = await (await api.get(`${B}/api/menu`)).json();
const P = menu.flatMap((c) => c.products);

// ---------------- 1. Caixa (PDV): acréscimos e troco
{
  const ctx = await context(browser, 'desk', 'caixa');
  const p = await ctx.newPage();
  await p.goto(`${B}/pdv`);
  await p.waitForSelector('.pos-grid');
  await p.mouse.move(800, 450);
  await sleep(400);
  await record(p, 'pdv', async () => {
    await sleep(900);
    await act(p, p.getByRole('group', { name: 'Categorias' }).getByRole('button', { name: /Hambúrgueres/ }));
    await act(p, p.getByRole('button', { name: /^X-Tudo,/ }));
    // acréscimos: toca no item do pedido
    await act(p, p.getByRole('button', { name: 'Editar X-Tudo' }));
    const d = p.getByRole('dialog', { name: /X-Tudo/ });
    await sleep(500);
    await act(p, d.getByRole('button', { name: 'Aumentar Bacon' }));
    await act(p, d.getByLabel('Sem milho'));
    await sleep(500);
    await act(p, d.getByRole('button', { name: /^(Adicionar|Atualizar) ·/ }));
    await act(p, p.getByRole('group', { name: 'Categorias' }).getByRole('button', { name: /Refrigerantes/ }));
    await act(p, p.getByRole('button', { name: /^Coca-Cola 2L,/ }));
    await sleep(600);
    await act(p, p.getByRole('button', { name: /^Cobrar/ }));
    const pay = p.getByRole('dialog', { name: /Receber/ });
    await sleep(700);
    await act(p, pay.getByRole('button', { name: 'R$ 100,00' }));
    await sleep(1300);
    await act(p, pay.getByRole('button', { name: /^Registrar/ }));
    await sleep(1800);
  });
  await ctx.close();
}

// ---------------- 2. Atendente no celular: mesa → produtos → cozinha
{
  const ctx = await context(browser, 'phone', 'atendente1');
  const p = await ctx.newPage();
  await p.goto(`${B}/atendente`);
  await p.waitForSelector('.tbl');
  await record(p, 'atendente', async () => {
    await sleep(1200);
    await act(p, p.getByRole('button', { name: /^Mesa 3,/ }), { tap: true });
    await sleep(500);
    await act(p, p.getByRole('button', { name: 'Adicionar produtos' }).first(), { tap: true });
    await act(p, p.getByRole('button', { name: 'X-Burguer', exact: true }), { tap: true });
    const d = p.getByRole('dialog', { name: /X-Burguer/ });
    await act(p, d.getByRole('button', { name: 'Aumentar Ovo' }), { tap: true });
    await act(p, d.getByRole('button', { name: 'Aumentar Cheddar' }), { tap: true });
    await sleep(400);
    await act(p, d.getByRole('button', { name: /^Adicionar ·/ }), { tap: true });
    await act(p, p.getByRole('button', { name: 'Adicionar produtos' }).first(), { tap: true });
    await act(p, p.getByRole('button', { name: 'Skol 600ml', exact: true }), { tap: true });
    await act(p, p.getByRole('button', { name: /^Concluir/ }), { tap: true });
    await sleep(600);
    await act(p, p.getByRole('button', { name: /^Conferir e enviar/ }), { tap: true });
    await sleep(500);
    await act(p, p.getByRole('button', { name: 'Enviar para a cozinha' }), { tap: true });
    await sleep(2000);
  });
  await ctx.close();
}

// ---------------- 3. Cozinha: o pedido chega na hora
{
  const ctx = await context(browser, 'desk', 'cozinha');
  const p = await ctx.newPage();
  await p.goto(`${B}/cozinha`);
  await p.waitForSelector('.tk');
  await p.mouse.move(800, 450);
  const beto = await context(browser, 'desk', 'atendente2');
  const v = (n) => P.find((x) => x.name === n).variants[0].id;
  await record(p, 'cozinha', async () => {
    await sleep(1200);
    await beto.request.post(`${B}/api/orders`, {
      headers: { ...H, 'idempotency-key': crypto.randomUUID() },
      data: { type: 'table', tableLabel: '9', send: true, items: [{ variantId: v('Lombo c/ Fritas'), quantity: 1 }, { variantId: v('X-Egg Bacon'), quantity: 1 }] },
    }).catch(() => undefined);
    await sleep(1800);
    const novo = p.locator('article.tk', { hasText: 'Mesa 9' }).first();
    await act(p, novo.getByRole('button', { name: 'Iniciar preparo' }));
    await sleep(1200);
    const m5 = p.locator('article.tk', { hasText: 'Mesa 5' }).first();
    await act(p, m5.getByRole('button', { name: 'Pronto' }));
    await sleep(1800);
  });
  await beto.close();
  await ctx.close();
}

// ---------------- 4. Delivery no celular: bairro, total com taxa, pagamento dividido
{
  const ctx = await context(browser, 'phone', 'admin', 'admin-e2e-123');
  const p = await ctx.newPage();
  await p.goto(`${B}/atendente/whatsapp/novo`);
  await p.waitForSelector('.wsec');
  await record(p, 'delivery', async () => {
    await sleep(800);
    await act(p, p.getByRole('button', { name: 'Entrega' }), { tap: true });
    await type(p.getByLabel('Telefone', { exact: true }).first(), '31988771020');
    await type(p.getByLabel('Nome', { exact: true }).first(), 'Carla Souza');
    await p.getByLabel('Bairro').selectOption({ index: 1 });
    await sleep(600);
    await type(p.getByLabel('Rua'), 'Av. Brasil');
    await type(p.getByLabel('Número'), '450');
    await act(p, p.getByRole('button', { name: 'Adicionar produtos' }).first(), { tap: true });
    await act(p, p.getByRole('button', { name: 'Contra Filé c/ Fritas', exact: true }), { tap: true });
    await act(p, p.getByRole('dialog', { name: /Contra Filé/ }).getByRole('button', { name: /^Adicionar ·/ }), { tap: true });
    await act(p, p.getByRole('button', { name: 'Coca-Cola 2L', exact: true }), { tap: true });
    await act(p, p.getByRole('button', { name: /^Concluir/ }), { tap: true });
    await sleep(500);
    await p.getByLabel('Valor total').scrollIntoViewIfNeeded();
    await sleep(1400);
    const g = p.getByRole('group', { name: 'Adicionar forma de pagamento' });
    await act(p, g.getByRole('button', { name: '+ Pix' }), { tap: true });
    await p.getByLabel('Valor em Pix').fill('40,00');
    await act(p, p.locator('.plan-paid input').first(), { tap: true });
    await act(p, g.getByRole('button', { name: '+ Dinheiro' }), { tap: true });
    await type(p.getByLabel('Troco para'), '50,00');
    await sleep(500);
    await p.getByLabel('Valor total').scrollIntoViewIfNeeded();
    await sleep(1600);
    await act(p, p.getByRole('button', { name: /^Enviar para a cozinha/ }), { tap: true });
    await sleep(2200);
  });
  await ctx.close();
}

// ---------------- 5. Conta da mesa dividida por itens
{
  const ctx = await context(browser, 'desk', 'caixa');
  const p = await ctx.newPage();
  const orders = await (await ctx.request.get(`${B}/api/orders?status=open&limit=50`)).json();
  const m8 = orders.find((o) => o.tableLabel === '8');
  await p.goto(`${B}/pedidos/${m8.id}`);
  await p.waitForSelector('.drawer');
  await p.mouse.move(1000, 500);
  await record(p, 'dividir', async () => {
    await sleep(900);
    await act(p, p.getByRole('button', { name: /^Receber R\$/ }));
    const d = p.getByRole('dialog', { name: /Receber/ });
    await sleep(600);
    await d.getByLabel('Dividir conta').selectOption({ label: 'Por itens (cada um paga o seu)' });
    await sleep(900);
    const it = d.getByRole('group', { name: 'Itens desta pessoa' });
    await act(p, it.getByRole('button', { name: 'Aumentar X-Egg Bacon' }));
    await act(p, it.getByRole('button', { name: 'Aumentar Coca-Cola 2L' }));
    await sleep(500);
    await act(p, d.getByRole('button', { name: 'Pix (conferido manualmente)' }));
    await sleep(700);
    await act(p, d.getByRole('button', { name: /^Registrar/ }));
    await sleep(1400);
    await act(p, it.getByRole('button', { name: 'Aumentar X-Picanha' }));
    await act(p, it.getByRole('button', { name: 'Aumentar Fritas' }));
    await sleep(1600);
  });
  await ctx.close();
}

// ---------------- 6. Cardápio digital (cliente pedindo de casa)
{
  const ctx = await context(browser, 'phone', null);
  const p = await ctx.newPage();
  await p.goto(`${B}/c`);
  await p.waitForSelector('.public-hero');
  await record(p, 'cardapio', async () => {
    await sleep(1300);
    await smoothScroll(p, 520);
    await sleep(1300);
    await act(p, p.getByRole('link', { name: 'Porções' }).first(), { tap: true });
    await sleep(1500);
    await smoothScroll(p, 400);
    await sleep(1400);
  });
  await ctx.close();
}

// ---------------- 7. Salão e entregas
{
  const p = await admin.newPage();
  await p.goto(`${B}/mesas`);
  await p.waitForSelector('.tbl');
  await p.mouse.move(700, 400);
  await record(p, 'salao', async () => {
    await sleep(1800);
    await p.mouse.move(1100, 300, { steps: 30 });
    await sleep(900);
    await act(p, p.getByRole('link', { name: 'Entregas' }));
    await sleep(2400);
  });
}

await browser.close();
