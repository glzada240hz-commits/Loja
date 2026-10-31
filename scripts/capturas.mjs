// Capturas de tela das telas principais em celular (390), tablet (1024) e caixa (1366), para revisão visual.
// Uso: node scripts/capturas.mjs <pasta-de-saída> [http://localhost:3000]
// Rode contra o ambiente de testes com o cenário fictício (scripts/cenario-teste.mjs).
import fs from 'node:fs';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'capturas';
const BASE = process.argv[3] ?? 'http://localhost:3000';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const VIEW = { phone: { width: 390, height: 844 }, tablet: { width: 1024, height: 768 }, desk: { width: 1366, height: 860 } };

async function as(user, view, mobile = false) {
  const ctx = await browser.newContext({ viewport: VIEW[view], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  if (user) {
    await page.goto(`${BASE}/login`);
    await page.getByLabel('Usuário').fill(user);
    await page.getByLabel('Senha').fill('demo1234');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  return { ctx, page };
}

async function shot(page, name, full = false) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log(name);
}

async function visit(page, path, name, full = false) {
  await page.goto(`${BASE}${path}`);
  await shot(page, name, full);
}

const tryClick = async (locator) => {
  try {
    await locator.first().click({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
};

// login
{
  const { ctx, page } = await as(null, 'phone', true);
  await visit(page, '/login', 'login-celular');
  await ctx.close();
}

// caixa no computador
{
  const { ctx, page } = await as('caixa', 'desk');
  await visit(page, '/pdv', 'pdv-caixa');
  if (await tryClick(page.getByRole('button', { name: /X-Bacon/ }))) await shot(page, 'pdv-produto-caixa');
  await page.keyboard.press('Escape');
  await visit(page, '/mesas', 'mesas-caixa');
  if (await tryClick(page.getByRole('button', { name: /Mesa 9/ }))) await shot(page, 'mesa-detalhe-caixa');
  await visit(page, '/pedidos', 'pedidos-caixa');
  await visit(page, '/caixa', 'caixa-caixa');
  await visit(page, '/expedicao', 'entregas-caixa');
  await ctx.close();
}
// caixa em tablet e celular
{
  const { ctx, page } = await as('caixa', 'tablet');
  await visit(page, '/pdv', 'pdv-tablet');
  await visit(page, '/mesas', 'mesas-tablet');
  await ctx.close();
  const m = await as('caixa', 'phone', true);
  await visit(m.page, '/pdv', 'pdv-celular');
  await visit(m.page, '/mesas', 'mesas-celular');
  await m.ctx.close();
}
// atendente no celular
{
  const { ctx, page } = await as('atendente1', 'phone', true);
  await shot(page, 'atendente-inicio');
  if (await tryClick(page.getByRole('button', { name: /^Mesa 2/ }))) {
    await shot(page, 'atendente-mesa');
    if (await tryClick(page.getByRole('button', { name: /Adicionar produtos/ }))) {
      await shot(page, 'atendente-produtos');
      if (await tryClick(page.getByRole('button', { name: 'X-Bacon', exact: true }))) await shot(page, 'atendente-item');
    }
  }
  await ctx.close();
}
// cozinha no tablet
{
  const { ctx, page } = await as('cozinha', 'tablet');
  await shot(page, 'cozinha-tablet');
  await ctx.close();
  const d = await as('cozinha', 'desk');
  await shot(d.page, 'cozinha-desk');
  await d.ctx.close();
}
// gestão
{
  const { ctx, page } = await as('gerente', 'desk');
  for (const [p, n] of [['/relatorios', 'relatorios'], ['/estoque', 'estoque'], ['/cardapio', 'cardapio-admin'], ['/despesas', 'despesas'], ['/clientes', 'clientes'], ['/ajustes', 'ajustes'], ['/whatsapp', 'whatsapp']]) await visit(page, p, `${n}-desk`);
  await ctx.close();
}
// entregador e cardápio digital no celular
{
  const { ctx, page } = await as('moto1', 'phone', true);
  await shot(page, 'entregador-celular');
  await ctx.close();
  const c = await as(null, 'phone', true);
  await visit(c.page, '/c', 'cardapio-digital-celular');
  if (await tryClick(c.page.getByRole('button', { name: /X-Bacon/ }))) await shot(c.page, 'cardapio-digital-item');
  await c.ctx.close();
}
await browser.close();
