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
  // os acréscimos passados pelo dono já vêm com o cardápio (sem cadastrar)
  await login(page, 'gerente');
  await page.goto('/cardapio');
  await page.getByRole('tab', { name: 'Adicionais' }).click();
  await expect(page.getByLabel('Acréscimo 1')).toHaveValue('Carne de picanha');

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const cel = await ctx.newPage();
  await login(cel, 'atendente1');
  await cel.getByRole('button', { name: /^Delivery/ }).click();
  await expect(cel).toHaveURL(/\/atendente\/whatsapp$/);
  await cel.getByRole('button', { name: 'Novo pedido (WhatsApp/telefone)' }).click();
  await cel.getByRole('button', { name: 'Adicionar produtos' }).first().click();
  await cel.getByRole('button', { name: 'X-Tudo', exact: true }).click();
  const dlg = cel.getByRole('dialog', { name: /X-Tudo/ });
  const acr = dlg.locator('fieldset.opt-group.acr').first();
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

test('atendente lança pedido para levar no balcão pelo celular', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const cel = await ctx.newPage();
  await login(cel, 'atendente2');
  await cel.getByRole('button', { name: /^Balcão/ }).click();
  await expect(cel).toHaveURL(/\/atendente\/balcao$/);
  await cel.getByRole('button', { name: 'Novo pedido para levar' }).click();
  await cel.getByRole('button', { name: 'Adicionar produtos' }).first().click();
  await cel.getByRole('button', { name: 'Coca-Cola 2L', exact: true }).click();
  await cel.getByRole('button', { name: /Concluir · 1 no rascunho/ }).click();
  await cel.getByLabel('Nome', { exact: true }).first().fill('Seu João');
  await cel.getByRole('button', { name: /Enviar para a cozinha · R\$ 17,00/ }).click();
  await expect(cel.getByText(/pagar no caixa/)).toBeVisible();
  await expect(cel.getByRole('link', { name: 'Avisar no WhatsApp' })).toHaveCount(0);
  await cel.getByRole('button', { name: 'Voltar' }).or(cel.getByRole('link', { name: 'Voltar' })).first().click();
  await expect(cel.locator('.wa-order', { hasText: 'Seu João' })).toBeVisible();
  await ctx.close();
});

test('atendente do celular: entrega com bairro mostra o total com a taxa antes de enviar', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const cel = await ctx.newPage();
  await login(cel, 'atendente1');
  await cel.goto('/atendente/whatsapp/novo');
  await cel.getByRole('button', { name: 'Entrega' }).click();
  await cel.getByRole('button', { name: 'Adicionar produtos' }).first().click();
  await cel.getByRole('button', { name: 'Coca-Cola 2L', exact: true }).click();
  await cel.getByRole('button', { name: /Concluir · 1 no rascunho/ }).click();
  await cel.getByLabel('Telefone', { exact: true }).first().fill('(31) 97777-1212');
  await cel.getByLabel('Nome', { exact: true }).first().fill('Pedro');
  const box = cel.getByLabel('Valor total');
  await expect(box).toContainText('escolha o bairro');
  // endereço colado do WhatsApp: separa rua/número e acha o bairro (taxa)
  await cel.getByLabel('Colar endereço do cliente').evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, 'Rua das Flores, 10\napto 3\nsanta martinha');
  await expect(cel.getByText('Bairro identificado: Santa Martinha')).toBeVisible();
  await expect(cel.getByLabel('Rua', { exact: true })).toHaveValue('Rua das Flores');
  await expect(cel.getByLabel('Número', { exact: true })).toHaveValue('10');
  await expect(cel.getByLabel('Complemento', { exact: true })).toHaveValue('apto 3');
  await expect(box).toContainText('Taxa de entrega (Santa Martinha)');
  // busca do bairro (sem acento, pedaço do nome)
  const bairro = cel.getByRole('combobox', { name: /^Bairro/ });
  await bairro.click();
  await bairro.fill('centr');
  await cel.getByRole('option', { name: /^Centro/ }).click();
  await expect(bairro).toHaveValue('Centro — R$ 5,00');
  await expect(box).toContainText('Taxa de entrega (Centro)');
  await expect(box.locator('dd.grand')).toHaveText('R$ 22,00');
  // pagamento dividido: R$ 20 em dinheiro (troco para 50) + o resto no Pix
  await cel.getByRole('group', { name: 'Adicionar forma de pagamento' }).getByRole('button', { name: '+ Dinheiro' }).click();
  await cel.getByLabel('Valor em Dinheiro').fill('20,00');
  await cel.getByRole('group', { name: 'Adicionar forma de pagamento' }).getByRole('button', { name: '+ Pix' }).click();
  await expect(cel.getByLabel('Valor em Pix')).toHaveValue('2,00');
  await expect(cel.getByText('Combinado: as partes fecham o total.')).toBeVisible();
  await cel.getByLabel('Troco para').fill('50,00');
  await expect(box).toContainText('R$ 30,00'); // troco sobre a parte em dinheiro
  await cel.getByRole('radio', { name: 'Com molho verde' }).click();
  await cel.getByRole('button', { name: /Enviar para a cozinha · R\$ 22,00/ }).click();
  await expect(cel.getByText(/na cozinha/).first()).toBeVisible();
  const link = await cel.getByRole('link', { name: 'Avisar no WhatsApp' }).getAttribute('href');
  expect(decodeURIComponent(link!)).toContain('Pagamento: Dinheiro R$ 20,00 + Pix R$ 2,00 (troco para R$ 50,00)');
  await ctx.close();
});

test('atendente lê o print da conversa: nome, endereço, bairro e itens; envia sem telefone com molho verde', async ({ browser }) => {
  test.setTimeout(120_000);
  // imagem parecida com um print do WhatsApp
  const shot = await browser.newPage({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2 });
  await shot.setContent(`<body style="margin:0;background:#efeae2;font-family:Arial,sans-serif">
    <div style="background:#075e54;color:#fff;padding:14px 16px;font-size:19px;font-weight:bold">Juliana Prado</div>
    <div style="padding:12px;display:grid;gap:8px;font-size:17px">
    <div style="background:#fff;padding:8px 10px;border-radius:8px">Boa noite! Quero 2 X-Tudo e 1 Coca-Cola 2L</div>
    <div style="background:#fff;padding:8px 10px;border-radius:8px">Rua das Acácias, 120<br>apto 2<br>Santa Martinha</div></div></body>`);
  const png = await shot.screenshot();
  await shot.close();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const cel = await ctx.newPage();
  await login(cel, 'atendente1');
  await cel.goto('/atendente/whatsapp/novo');
  await cel.getByRole('button', { name: 'Entrega' }).click();
  await cel.getByLabel('Imagem do print da conversa').setInputFiles({ name: 'print.png', mimeType: 'image/png', buffer: png });
  await expect(cel.getByText('Lido do print')).toBeVisible({ timeout: 90_000 });
  await expect(cel.getByLabel('Nome', { exact: true }).first()).toHaveValue('Juliana Prado');
  await expect(cel.getByLabel('Rua', { exact: true })).toHaveValue('Rua das Acácias');
  await expect(cel.getByLabel('Número', { exact: true })).toHaveValue('120');
  await expect(cel.getByRole('combobox', { name: /^Bairro/ })).toHaveValue('Santa Martinha — R$ 4,00');
  await cel.getByRole('button', { name: 'Adicionar ao pedido' }).click();
  const box = cel.getByLabel('Valor total');
  await expect(box.locator('dd.grand')).toHaveText('R$ 64,80'); // 2 x 21,90 + 17,00 + taxa 4,00
  // molho verde é obrigatório na entrega; telefone não
  await expect(cel.getByRole('button', { name: /Falta: molho verde/ })).toBeVisible();
  await cel.getByRole('radio', { name: 'Sem molho verde' }).click();
  await cel.getByRole('button', { name: /Enviar para a cozinha · R\$ 64,80/ }).click();
  await expect(cel.getByText(/Entrega \d+ na cozinha/).first()).toBeVisible();
  await ctx.close();
});

test('admin zera os pedidos de teste em Ajustes (digitando ZERAR)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill('admin');
  await page.getByLabel('Senha').fill('admin-e2e-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  expect(((await (await page.request.get('/api/orders?status=open,pending,closed,cancelled')).json()) as unknown[]).length).toBeGreaterThan(0);
  await page.goto('/ajustes');
  await page.getByRole('button', { name: 'Zerar pedidos de teste…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Zerar pedidos de teste' });
  await expect(dlg.getByRole('button', { name: 'Zerar agora' })).toBeDisabled();
  await dlg.getByLabel('Para confirmar, digite ZERAR').fill('ZERAR');
  await dlg.getByRole('button', { name: 'Zerar agora' }).click();
  await expect(page.getByRole('dialog', { name: 'Pedidos zerados' })).toContainText('A numeração dos pedidos recomeça do 1');
  expect(await (await page.request.get('/api/orders?status=open,pending,closed,cancelled')).json()).toHaveLength(0);
  expect(((await (await page.request.get('/api/menu')).json()) as unknown[]).length).toBeGreaterThan(0);
});
