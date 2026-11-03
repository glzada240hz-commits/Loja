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

test('admin cadastra atendente pelo celular como a pessoa digita ("Ana Paula") e ela entra no celular', async ({ browser }) => {
  const adm = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const p = await adm.newPage();
  await p.goto('/login');
  await p.getByLabel('Usuário').fill('admin');
  await p.getByLabel('Senha').fill('admin-e2e-123');
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  await p.goto('/ajustes?aba=users');
  await p.getByRole('button', { name: '+ Usuário' }).click();
  const dlg = p.getByRole('dialog', { name: 'Novo usuário' });
  await dlg.getByLabel('Nome da pessoa').pressSequentially('Ana Paula');
  await dlg.getByLabel('Usuário (para entrar)').fill('');
  await dlg.getByLabel('Usuário (para entrar)').pressSequentially('Ana Paula');
  await expect(dlg.getByLabel('Usuário (para entrar)')).toHaveValue('Ana Paula'); // o texto não "volta" enquanto digita
  await expect(dlg).toContainText('Entra como: ana.paula');
  await expect(dlg.getByLabel('Perfil')).toHaveValue('waiter');
  await dlg.getByLabel('Senha').pressSequentially('Senha1234');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  const ok = p.getByRole('dialog', { name: 'Usuário pronto para entrar' });
  await expect(ok).toContainText('ana.paula');
  await expect(ok).toContainText('Senha1234');
  await adm.close();

  const cel = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const c = await cel.newPage();
  await c.goto('/login');
  await c.getByLabel('Usuário').fill('Ana Paula'); // do jeito que ela lembra
  await c.getByLabel('Senha').fill('Senha1234');
  await c.getByRole('button', { name: 'Entrar' }).click();
  await expect(c).toHaveURL(/\/atendente$/);
  await cel.close();
});

test('caixa cancela pedido com autorização do gerente digitada (sem preenchimento automático)', async ({ page }) => {
  await login(page, 'caixa');
  const H = { 'x-requested-with': 'guto' };
  const menu = await (await page.request.get('/api/menu')).json();
  const variantId = menu[0].products[0].variants[0].id;
  const o = await (await page.request.post('/api/orders', { headers: { ...H, 'idempotency-key': `e2e-cancel-${Date.now()}` }, data: { type: 'counter', send: true, items: [{ variantId, quantity: 1 }] } })).json();
  await page.goto(`/pedidos/${o.id}`);
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: /Cancelar pedido/ }).click();
  const c = page.getByRole('dialog', { name: `Cancelar pedido #${o.number}` });
  await c.getByLabel('Motivo do cancelamento').fill('Cliente desistiu');
  await c.getByRole('button', { name: 'Cancelar pedido' }).click();
  const sup = page.getByRole('dialog', { name: 'Autorização do gerente' });
  await expect(sup.getByLabel('Usuário do gerente ou administrador')).toHaveValue('');
  await expect(sup.getByLabel('Senha')).toHaveValue('');
  // senha errada: avisa e pede de novo, sem deslogar o caixa
  await sup.getByLabel('Usuário do gerente ou administrador').pressSequentially('gerente');
  await sup.getByLabel('Senha').pressSequentially('errada123');
  await expect(sup.getByLabel('Usuário do gerente ou administrador')).toHaveValue('gerente'); // o cursor não volta
  await expect(sup.getByLabel('Senha')).toHaveValue('errada123');
  await sup.getByRole('button', { name: 'Autorizar' }).click();
  await expect(sup).toContainText('senha do gerente incorretos');
  await expect(page).not.toHaveURL(/\/login/);
  await sup.getByLabel('Usuário do gerente ou administrador').fill('');
  await sup.getByLabel('Usuário do gerente ou administrador').pressSequentially('Gerente');
  await expect(sup.getByLabel('Usuário do gerente ou administrador')).toHaveValue('Gerente');
  await sup.getByLabel('Senha').pressSequentially('demo1234');
  await sup.getByRole('button', { name: 'Autorizar' }).click();
  await expect(page.getByText('Pedido cancelado').first()).toBeVisible();
});

test('celular: sair de dentro do Delivery e entrar com outra conta cai na tela da nova conta', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await login(p, 'atendente1');
  await p.goto('/atendente/whatsapp/novo');
  await p.getByRole('button', { name: 'Sair' }).click();
  await expect(p).toHaveURL(/\/login$/);
  await p.getByLabel('Usuário').fill('caixa');
  await p.getByLabel('Senha').fill('demo1234');
  await p.getByRole('button', { name: 'Entrar' }).click();
  await expect(p).toHaveURL(/\/pdv$/); // tela do caixa, não a do atendente que saiu
  await p.getByRole('button', { name: 'Abrir menu' }).first().click();
  await p.getByRole('button', { name: 'Sair' }).first().click();
  await expect(p).toHaveURL(/\/login$/);
  await p.getByLabel('Usuário').fill('atendente2');
  await p.getByLabel('Senha').fill('demo1234');
  await p.getByRole('button', { name: 'Entrar' }).click();
  await expect(p).toHaveURL(/\/atendente$/);
  await expect(p.locator('.waiter-title small')).toHaveText('Atendente Beto (demo)');
  await ctx.close();
});
