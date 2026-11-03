import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page, user: string) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(user);
  await page.getByLabel('Senha').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.beforeAll(async ({ browser }) => {
  // independente da ordem: garante dia e caixa abertos
  const page = await browser.newPage();
  await login(page, 'gerente');
  const H = { 'x-requested-with': 'guto' };
  const day = await (await page.request.get('/api/day')).json();
  if (!day.day) await page.request.post('/api/day/open', { headers: H, data: {} });
  if (!day.cash) await page.request.post('/api/cash/open', { headers: H, data: { openingCents: 10000 } });
  await page.close();
});

test('PDV: busca tolerante a erro de digitação adiciona com Enter e mostra a quantidade no cartão', async ({ page }) => {
  await login(page, 'caixa');
  await page.goto('/pdv');
  const search = page.getByLabel('Buscar produto');
  await search.fill('xbacn'); // sem hífen e com uma letra faltando
  await expect(page.getByRole('button', { name: /^X-Bacon, R\$/ })).toBeVisible();
  await search.fill('btaata frita'); // letras trocadas
  await expect(page.getByRole('button', { name: /^Batata frita, R\$/ })).toBeVisible();
  await search.fill('20'); // código exato
  await search.press('Enter');
  await expect(search).toHaveValue('');
  await expect(page.getByRole('button', { name: /^Batata frita, R\$ 22,90, 1 no pedido/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pedido atual' })).toContainText('Batata frita');
  // nada é enviado sem confirmação: o botão continua disponível e o pedido não existe no servidor
  const before = await (await page.request.get('/api/orders?status=open,pending')).json();
  expect(before.some((o: { customerName: string | null; totalCents: number }) => o.totalCents === 2290)).toBe(false);
});

test('atendente: bebida entra com um toque e "repetir" só vai para o rascunho (não envia sozinho)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  await login(page, 'atendente2');
  await page.getByRole('button', { name: /^Mesa 11/ }).click();
  await page.getByRole('button', { name: 'Adicionar produtos' }).click();
  await page.getByRole('button', { name: 'Refrigerante lata', exact: true }).click();
  await page.getByRole('button', { name: 'Refrigerante lata', exact: true }).click();
  await expect(page.getByLabel('2 no rascunho')).toBeVisible();
  await page.getByRole('button', { name: /^Concluir · 2 no rascunho/ }).click();
  await page.getByRole('button', { name: 'Conferir e enviar (2)' }).click();
  await page.getByRole('button', { name: 'Enviar para a cozinha' }).click();
  await expect(page.getByText(/Recebido pelo servidor/)).toBeVisible();
  const id = page.url().split('/').pop()!;
  const sent = await (await page.request.get(`/api/orders/${id}`)).json();
  // repetir
  await page.getByRole('button', { name: 'Repetir Refrigerante lata' }).click();
  await expect(page.getByRole('button', { name: 'Conferir e enviar (1)' })).toBeVisible();
  const after = await (await page.request.get(`/api/orders/${id}`)).json();
  expect(after.items).toHaveLength(sent.items.length); // nada foi enviado ao servidor
  await ctx.close();
});

test('gerente no app do atendente consegue voltar ao sistema (o aplicativo da loja não tem botão Voltar do navegador)', async ({ page }) => {
  await login(page, 'gerente');
  await page.goto('/atendente');
  await page.getByRole('link', { name: 'Voltar ao sistema' }).click();
  await expect(page).not.toHaveURL(/\/atendente/);
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
});

test('item cadastrado no Estoque com "Vender este item" aparece na hora no celular do atendente (mesas)', async ({ page, browser }) => {
  await login(page, 'gerente');
  await page.goto('/estoque');
  await page.getByRole('button', { name: '+ Novo item' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo item do estoque' });
  await dlg.getByLabel('Nome', { exact: true }).fill('Água com gás');
  await dlg.getByLabel(/Quantidade que tem agora/).fill('10');
  await dlg.getByLabel(/Vender este item/).check();
  await dlg.getByLabel('Categoria no cardápio').selectOption({ label: 'Bebidas' });
  await dlg.getByLabel('Preço de venda').fill('5,00');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText(/Salvo e à venda/)).toBeVisible();
  const row = page.getByRole('row', { name: /Água com gás/ });
  await expect(row).toContainText('10 un');
  await expect(row).toContainText('Água com gás'); // coluna "Vendido / usado em"

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const cel = await ctx.newPage();
  await login(cel, 'atendente2');
  await cel.getByRole('button', { name: /^Mesa 12/ }).click();
  await cel.getByRole('button', { name: 'Adicionar produtos' }).click();
  await expect(cel.getByRole('button', { name: 'Água com gás', exact: true })).toBeVisible();
  await ctx.close();
});
