// Capturas para comparação antes/depois: mesmas telas, mesmas resoluções, mesmas ações e rolagem no topo.
// Uso: node scripts/capturas-comparativo.mjs <pasta> [http://localhost:3000]
// Rode logo após: zerar dados de teste + iniciar + node scripts/cenario-teste.mjs <url>
import fs from 'node:fs';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'comparativo';
const BASE = process.argv[3] ?? 'http://localhost:3000';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const sessions = new Map();

async function open(user, width, height, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', isMobile: mobile, hasTouch: mobile, storageState: sessions.get(user) });
  const page = await ctx.newPage();
  if (!sessions.has(user)) {
    await page.goto(`${BASE}/login`);
    await page.getByLabel('Usuário').fill(user);
    await page.getByLabel('Senha').fill('demo1234');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    sessions.set(user, await ctx.storageState());
  }
  return { ctx, page };
}
async function shot(page, name) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name);
}

// PDV no computador do caixa (1366 x 768): vazio, com 3 itens, e a tela de pagamento
{
  const { ctx, page } = await open('caixa', 1366, 768);
  await page.goto(`${BASE}/pdv`);
  await shot(page, 'pdv-1366x768-vazio');
  for (const re of [/^X-Bacon, R\$/, /^X-Bacon, R\$/, /^Batata frita, R\$/, /^Refrigerante lata, R\$/]) await page.getByRole('button', { name: re }).first().click();
  await shot(page, 'pdv-1366x768-com-itens');
  await page.keyboard.press('F9');
  await page.getByRole('dialog').waitFor();
  await shot(page, 'pdv-1366x768-pagamento');
  await ctx.close();
}
// Mesas (1366 x 768)
{
  const { ctx, page } = await open('caixa', 1366, 768);
  await page.goto(`${BASE}/mesas`);
  await shot(page, 'mesas-1366x768');
  await ctx.close();
}
// Atendente no celular (390 x 844)
{
  const { ctx, page } = await open('atendente1', 390, 844, true);
  await page.goto(`${BASE}/atendente`);
  await shot(page, 'atendente-390-inicio');
  await page.getByRole('button', { name: /^Mesa 2/ }).click();
  await shot(page, 'atendente-390-mesa');
  await ctx.close();
}
// Cozinha (tablet 1024 x 768 e TV/monitor 1366 x 768)
{
  const t = await open('cozinha', 1024, 768);
  await t.page.goto(`${BASE}/cozinha`);
  await shot(t.page, 'cozinha-1024x768');
  await t.ctx.close();
  const d = await open('cozinha', 1366, 768);
  await d.page.goto(`${BASE}/cozinha`);
  await shot(d.page, 'cozinha-1366x768');
  await d.ctx.close();
}
await browser.close();
