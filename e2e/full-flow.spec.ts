import { expect, test, type Browser, type Page } from '@playwright/test';

const SHOTS = 'test-results/screens';

async function login(browser: Browser, user: string, viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(user);
  await page.getByLabel('Senha').fill(user === 'admin' ? 'admin-e2e-123' : 'demo1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

test.describe.serial('16. fluxo completo: cardápio digital → cozinha → entrega → caixa', () => {
  let gerente: Page;
  let caixa: Page;
  let cliente: Page;
  let trackUrl = '';

  test('gerente abre o dia e o caixa', async ({ browser }) => {
    gerente = await login(browser, 'gerente');
    await gerente.goto('/caixa');
    await gerente.getByRole('button', { name: 'Abrir dia' }).click();
    await expect(gerente.getByText('Aberto em')).toBeVisible();
    await gerente.getByLabel('Fundo de troco (valor inicial)').fill('100,00');
    await gerente.getByRole('button', { name: 'Abrir caixa' }).click();
    await expect(gerente.getByText(/Aberto às .* com R\$ 100,00/)).toBeVisible();
  });

  test('cliente monta o pedido no celular e confirma', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', isMobile: true, hasTouch: true });
    cliente = await ctx.newPage();
    await cliente.goto('/c');
    await expect(cliente.getByText('Aberto para pedidos')).toBeVisible();
    await cliente.locator('.menu-item', { hasText: 'X-Bacon' }).click();
    await cliente.getByRole('button', { name: 'Aumentar Cheddar' }).click();
    await cliente.getByLabel('Sem cebola').check();
    await cliente.getByLabel('Observação do item').fill('bem passado');
    await shot(cliente, '01-cliente-adicionais');
    await cliente.getByRole('button', { name: /Adicionar · R\$ 22,90/ }).click();
    await cliente.locator('.menu-item', { hasText: 'Batata frita' }).click();
    await cliente.getByRole('button', { name: /Adicionar/ }).click();
    await cliente.getByRole('button', { name: /Ver carrinho · 2 item/ }).click();
    await cliente.getByLabel('Seu nome').fill('Ana Cliente');
    await cliente.getByLabel('Telefone (WhatsApp)').fill('(11) 96666-5555');
    await cliente.getByLabel('Bairro').selectOption({ label: 'Centro — entrega R$ 5,00' });
    await cliente.getByLabel('Rua').fill('Rua das Flores');
    await cliente.getByLabel('Número').fill('120');
    await cliente.getByLabel('Troco para (opcional)').fill('100,00');
    await expect(cliente.locator('.totals .grand').last()).toHaveText('R$ 50,80');
    await cliente.getByText('Concordo com o uso').click();
    await shot(cliente, '02-cliente-checkout');
    await cliente.getByRole('button', { name: /Confirmar pedido · R\$ 50,80/ }).click();
    await cliente.waitForURL(/\/c\/pedido\//);
    trackUrl = cliente.url();
    await expect(cliente.getByText('ainda será CONFIRMADO')).toBeVisible();
    await expect(cliente.getByRole('heading', { name: 'Pedido #1' })).toBeVisible();
    await shot(cliente, '03-cliente-acompanhamento');
  });

  test('caixa aceita o pedido online', async ({ browser }) => {
    caixa = await login(browser, 'caixa');
    await caixa.goto('/pedidos');
    await caixa.getByRole('button', { name: 'Aguardando aceite' }).click();
    await caixa.getByRole('cell', { name: '#1' }).click();
    await expect(caixa.getByText('aguardando aceite', { exact: false }).first()).toBeVisible();
    await caixa.getByRole('button', { name: 'Aceitar pedido' }).click();
    await caixa.getByRole('button', { name: '40 min' }).click();
    await caixa.getByRole('button', { name: 'Aceitar e enviar à cozinha' }).click();
    await expect(caixa.getByText('Pedido aceito e enviado à cozinha')).toBeVisible();
    await shot(caixa, '04-caixa-pedido-aceito');
  });

  test('cozinha prepara e marca pronto (atualização entre dispositivos)', async ({ browser }) => {
    const k = await login(browser, 'cozinha', { width: 1024, height: 768 });
    await k.goto('/cozinha');
    const ticket = k.getByRole('article', { name: 'Pedido 1' });
    await expect(ticket).toBeVisible();
    await expect(ticket.getByText('“bem passado”')).toBeVisible();
    await expect(ticket.getByText('SEM CEBOLA')).toBeVisible();
    await shot(k, '05-cozinha');
    await ticket.getByRole('button', { name: 'Iniciar preparo' }).click();
    await expect(k.getByRole('region', { name: 'Em preparo' }).getByRole('article', { name: 'Pedido 1' })).toBeVisible();
    await k.getByRole('article', { name: 'Pedido 1' }).getByRole('button', { name: 'Pronto' }).click();
    await expect(k.getByRole('region', { name: /Prontos/ }).getByRole('article', { name: 'Pedido 1' })).toBeVisible();
    await cliente.goto(trackUrl);
    await expect(cliente.locator('.track-steps li.done', { hasText: 'Pronto' })).toBeVisible();
  });

  test('expedição agrupa, atribui e despacha', async () => {
    await caixa.goto('/expedicao');
    await caixa.getByLabel('Selecionar pedido 1').check();
    await caixa.getByLabel('Entregador').selectOption({ label: 'Entregador 1 (demo)' });
    await caixa.getByRole('button', { name: /^Atribuir/ }).click();
    await expect(caixa.getByText('Entregas atribuídas')).toBeVisible();
    await caixa.getByRole('button', { name: 'Saiu para entrega' }).click();
    await expect(caixa.getByRole('heading', { name: 'Em rota (1)' })).toBeVisible();
    await shot(caixa, '06-expedicao');
    await cliente.goto(trackUrl);
    await expect(cliente.locator('.track-steps li.done', { hasText: 'Saiu para entrega' })).toBeVisible();
  });

  test('entregador vê só a própria entrega e conclui', async ({ browser }) => {
    const outro = await login(browser, 'moto2', { width: 390, height: 844 });
    await outro.goto('/entregador');
    await expect(outro.getByText('Nenhuma entrega em rota')).toBeVisible();
    const m = await login(browser, 'moto1', { width: 390, height: 844 });
    await m.goto('/entregador');
    await expect(m.getByText('Receber: R$ 50,80')).toBeVisible();
    await expect(m.getByText('Levar troco para R$ 100,00 (troco R$ 49,20)')).toBeVisible();
    await shot(m, '07-entregador');
    await m.getByRole('button', { name: 'Entregue' }).click();
    await m.getByRole('dialog').getByRole('button', { name: 'Entregue' }).click();
    await expect(m.getByRole('heading', { name: 'Entregues hoje (1)' })).toBeVisible();
  });

  test('caixa recebe com troco e finaliza', async () => {
    await caixa.goto('/pedidos');
    await caixa.getByRole('cell', { name: '#1' }).click();
    await caixa.getByRole('button', { name: 'Receber R$ 50,80' }).click();
    const dlg = caixa.getByRole('dialog', { name: /Receber/ });
    await expect(dlg.getByLabel('Valor recebido em dinheiro')).toHaveValue('100,00');
    await expect(dlg.getByTestId('troco')).toHaveText('R$ 49,20');
    await shot(caixa, '08-pagamento-troco');
    await dlg.getByRole('button', { name: /Registrar R\$ 50,80/ }).click();
    await expect(caixa.getByText('Pagamento registrado')).toBeVisible();
    await caixa.getByRole('button', { name: 'Finalizar pedido' }).click();
    await expect(caixa.getByText('Pedido finalizado').first()).toBeVisible();
    await expect(caixa.locator('.drawer .badge', { hasText: 'Finalizado' })).toBeVisible();
    await shot(caixa, '09-pedido-finalizado');
  });

  test('9. PDV: clique duplo não duplica pedido', async () => {
    await caixa.goto('/pdv');
    await caixa.getByRole('button', { name: /^X-Burguer, R\$ 13,50/ }).click();
    await caixa.getByRole('button', { name: /^X-Burguer, R\$ 13,50/ }).click();
    await caixa.getByRole('button', { name: /^Refrigerante lata/ }).click();
    await expect(caixa.locator('.cart-foot .grand').last()).toHaveText('R$ 33,00');
    await shot(caixa, '10-pdv-carrinho');
    await caixa.getByRole('button', { name: 'Enviar pedido' }).dblclick();
    await expect(caixa.getByRole('heading', { name: 'Pedido #2 registrado' })).toBeVisible();
    const list = await (await caixa.request.get('/api/orders')).json();
    expect(list.filter((o: any) => o.number === 2)).toHaveLength(1);
    expect(list).toHaveLength(2);
    await caixa.getByRole('button', { name: 'Novo pedido' }).click();
  });

  test('gerente fecha o caixa sem divergência', async () => {
    await gerente.goto('/caixa');
    await expect(gerente.getByText('R$ 150,80').first()).toBeVisible();
    await gerente.getByRole('button', { name: 'Fechar caixa' }).click();
    await gerente.getByLabel('Dinheiro contado').fill('150,80');
    await gerente.getByRole('dialog').getByRole('button', { name: 'Fechar caixa' }).click();
    await expect(gerente.getByRole('heading', { name: 'Caixa fechado' })).toBeVisible();
    await shot(gerente, '11-caixa-fechado');
    await gerente.getByRole('button', { name: 'OK' }).click();
  });
});

test('queda de conexão é sinalizada claramente', async ({ browser }) => {
  const page = await login(browser, 'caixa');
  await page.goto('/pedidos');
  await expect(page.getByText('Online', { exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByRole('alert').filter({ hasText: 'Sem conexão com o servidor' })).toBeVisible();
  await shot(page, '12-offline');
  await page.context().setOffline(false);
  await expect(page.getByText('Online', { exact: true })).toBeVisible({ timeout: 15000 });
});

test('perfil cozinha não acessa telas do caixa', async ({ browser }) => {
  const page = await login(browser, 'cozinha');
  await page.goto('/relatorios');
  await expect(page).toHaveURL(/\/cozinha$/);
  const r = await page.request.get('/api/reports/sales?from=2020-01-01&to=2030-01-01');
  expect(r.status()).toBe(403);
});
