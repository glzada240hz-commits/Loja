import { expect, test } from '@playwright/test';

// roda por último (troca o cardápio de exemplo pelo oficial)
async function login(page: import('@playwright/test').Page, user: string) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(user);
  await page.getByLabel('Senha').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test('gerente confere e importa o cardápio do Bar do Guto; aparece no PDV com os preços certos', async ({ page }) => {
  await login(page, 'gerente');
  await page.goto('/cardapio');
  await page.getByRole('button', { name: 'Conferir e importar' }).click();
  const dlg = page.getByRole('dialog', { name: 'Conferir o cardápio antes de importar' });
  await expect(dlg.getByRole('row', { name: /Contra Filé c\/ Fritas/ })).toContainText('R$ 64,90');
  await expect(dlg.getByRole('row', { name: /Heineken/ })).toContainText('Long neck R$ 12,00');
  await dlg.getByRole('button', { name: 'Importar cardápio' }).click();
  const done = page.getByRole('dialog', { name: 'Cardápio importado' });
  await expect(done).toContainText('Tirados de venda (exemplo)');
  await done.getByRole('button', { name: 'Concluir' }).click();

  await page.goto('/pdv');
  await expect(page.getByRole('group', { name: 'Categorias' }).getByRole('button', { name: /Hambúrgueres/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Contra Filé c\/ Fritas, R\$ 64,90/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^X-Bacon,/ })).toHaveCount(0);
});

test('acréscimos em verde + atendente lança pedido do WhatsApp no celular e ele sai na cozinha', async ({ page, browser }) => {
  // gerente cadastra os acréscimos dos hambúrgueres
  await login(page, 'gerente');
  await page.goto('/cardapio');
  await page.getByRole('tab', { name: 'Adicionais' }).click();
  await page.getByRole('button', { name: '+ Acréscimo' }).click();
  await page.getByLabel('Acréscimo 1').fill('Bacon');
  await page.locator('.addon-row').first().locator('input').nth(1).fill('4,00');
  await page.getByRole('button', { name: 'Salvar acréscimos' }).click();
  await expect(page.getByText(/Acréscimos salvos/)).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const cel = await ctx.newPage();
  await login(cel, 'atendente1');
  await cel.getByRole('button', { name: /^WhatsApp/ }).click();
  await expect(cel).toHaveURL(/\/atendente\/whatsapp$/);
  await cel.getByRole('button', { name: 'Novo pedido do WhatsApp' }).click();
  await cel.getByRole('button', { name: 'Adicionar produtos' }).first().click();
  await cel.getByRole('button', { name: 'X-Tudo', exact: true }).click();
  const dlg = cel.getByRole('dialog', { name: /X-Tudo/ });
  const acr = dlg.locator('fieldset.opt-group.acr');
  await expect(acr).toContainText('Acréscimos');
  await expect(acr).toContainText('+ R$ 4,00');
  await expect(acr).toHaveCSS('background-color', 'rgb(240, 253, 244)'); // verde
  await dlg.getByRole('button', { name: 'Aumentar Bacon' }).click();
  await dlg.getByLabel('Sem milho').check();
  await dlg.getByRole('button', { name: /^Adicionar · R\$ 25,90/ }).click();
  await cel.getByRole('button', { name: /Concluir · 1 no rascunho/ }).click();
  await cel.getByLabel('Telefone', { exact: true }).first().fill('(31) 98888-7777');
  await cel.getByLabel('Nome', { exact: true }).first().fill('Cliente Zap');
  await cel.getByRole('button', { name: /Enviar para a cozinha · R\$ 25,90/ }).click();
  await expect(cel.getByText(/na cozinha/).first()).toBeVisible();
  const link = cel.getByRole('link', { name: 'Avisar no WhatsApp' });
  await expect(link).toHaveAttribute('href', /^https:\/\/wa\.me\/5531988887777\?text=.*X-Tudo/);
  const id = (await (await cel.request.get('/api/orders?status=open&limit=5')).json()).find((o: any) => o.source === 'whatsapp');
  expect(id).toBeTruthy();

  // cozinha recebe com o acréscimo e o "sem"
  const k = await (await page.request.get('/api/kitchen')).json();
  const t = k.tickets.find((x: any) => x.orderNumber === id.number);
  expect(t.items[0].options.map((o: any) => o.name)).toEqual(expect.arrayContaining(['Bacon', 'Sem milho']));
  await ctx.close();
});
