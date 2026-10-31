import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const SHOTS = 'test-results/screens';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function session(browser: Browser, user: string, viewport: { width: number; height: number }, mobile = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(user);
  await page.getByLabel('Senha').fill(user === 'admin' ? 'admin-e2e-123' : 'demo1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}

const H = { 'x-requested-with': 'guto' };

test.describe.serial('Atendente + caixa + cozinha em três aparelhos simultâneos', () => {
  let atendente: Page;
  let atendenteCtx: BrowserContext;
  let caixa: Page;
  let cozinha: Page;
  let orderId = '';

  test('prepara a loja e abre as três sessões', async ({ browser }) => {
    const g = await session(browser, 'gerente', { width: 1280, height: 800 });
    const day = await (await g.page.request.get('/api/day')).json();
    if (!day.day) expect((await g.page.request.post('/api/day/open', { headers: H, data: {} })).ok()).toBe(true);
    if (!day.cash) expect((await g.page.request.post('/api/cash/open', { headers: H, data: { openingCents: 10000 } })).ok()).toBe(true);
    await g.ctx.close();

    const a = await session(browser, 'atendente1', { width: 390, height: 844 }, true);
    atendente = a.page;
    atendenteCtx = a.ctx;
    caixa = (await session(browser, 'caixa', { width: 1366, height: 860 })).page;
    cozinha = (await session(browser, 'cozinha', { width: 1024, height: 768 })).page;
    await expect(atendente).toHaveURL(/\/atendente$/); // perfil atendente cai direto no app
    await caixa.goto('/mesas');
    await cozinha.goto('/cozinha');
    for (const p of [atendente, caixa, cozinha]) await expect(p.getByText('Online', { exact: true })).toBeVisible();
  });

  test('atendente lança o pedido no celular; caixa e cozinha recebem sem recarregar', async () => {
    await atendente.getByRole('button', { name: /^Mesa 8/ }).click();
    await expect(atendente.getByText('Novo pedido')).toBeVisible();
    await atendente.getByRole('button', { name: 'Adicionar produtos' }).click();
    await atendente.getByRole('button', { name: 'X-Bacon', exact: true }).click();
    await atendente.getByRole('button', { name: 'Aumentar Cheddar' }).click();
    await atendente.getByLabel('Sem cebola').check();
    await atendente.getByLabel('Observação do item').fill('bem passado');
    await atendente.getByRole('button', { name: /^Adicionar · R\$ 22,90/ }).click();
    await atendente.getByRole('button', { name: 'Adicionar produtos' }).click();
    // bebida sem adicionais entra no rascunho com um toque; o seletor continua aberto
    await atendente.getByRole('button', { name: 'Refrigerante lata', exact: true }).click();
    await atendente.getByRole('button', { name: /^Concluir · 2 no rascunho/ }).click();
    await expect(atendente.getByText('“bem passado”')).toBeVisible();
    await atendente.getByRole('button', { name: 'Conferir e enviar (2)' }).click();
    await shot(atendente, 'w01-atendente-conferir');
    await atendente.getByRole('button', { name: 'Enviar para a cozinha' }).click();
    await expect(atendente.getByText(/Recebido pelo servidor às .* rodada 1/)).toBeVisible();
    await expect(atendente).toHaveURL(/\/atendente\/pedido\//);
    orderId = atendente.url().split('/').pop()!;
    await shot(atendente, 'w02-atendente-enviado');

    // caixa: chega sozinho, com responsável, valor e andamento
    const tile = caixa.getByRole('button', { name: /^Mesa 8, pedido/ });
    await expect(tile).toBeVisible();
    await expect(tile).toContainText('Atendente Ana');
    await expect(tile).toContainText('R$ 28,90');
    await expect(tile).toContainText('1 enviado');
    // cozinha: mesa, atendente, adicionais e observação em destaque
    const t1 = cozinha.locator('article', { hasText: 'Mesa 8' });
    await expect(t1).toHaveCount(1);
    await expect(t1).toContainText('por Atendente Ana (demo)');
    await expect(t1).toContainText('SEM CEBOLA');
    await expect(t1).toContainText('“bem passado”');
    await expect(t1).not.toContainText('Refrigerante'); // bebida não vai para a cozinha
    await shot(cozinha, 'w03-cozinha-recebeu');
  });

  test('acréscimo vira nova rodada só com os itens novos', async () => {
    await cozinha.locator('article', { hasText: 'Mesa 8' }).getByRole('button', { name: 'Iniciar preparo' }).click();
    await atendente.getByRole('button', { name: 'Adicionar produtos' }).click();
    await atendente.getByRole('button', { name: 'Batata frita', exact: true }).click();
    await atendente.getByLabel('Observação do item').fill('bem crocante');
    await atendente.getByRole('button', { name: /^Adicionar · / }).click();
    await atendente.getByRole('button', { name: 'Conferir e enviar (1)' }).click();
    await atendente.getByRole('button', { name: 'Enviar para a cozinha' }).click();
    await expect(atendente.getByText(/rodada 2/)).toBeVisible();

    const extra = cozinha.locator('article', { hasText: 'ACRÉSCIMO' });
    await expect(extra).toBeVisible();
    await expect(extra).toContainText('Batata frita');
    await expect(extra).toContainText('“bem crocante”');
    await expect(extra).not.toContainText('X-Bacon'); // itens antigos não são reenviados
    const r1 = cozinha.getByRole('region', { name: 'Em preparo' }).locator('article', { hasText: 'Mesa 8' });
    await expect(r1).toContainText('X-Bacon'); // histórico mantido no estado em que estava
    await expect(caixa.getByRole('button', { name: /^Mesa 8, pedido/ })).toContainText('R$ 51,80');
    await shot(cozinha, 'w04-cozinha-acrescimo');
  });

  test('cozinha atualiza o preparo; atendente entrega; todos veem', async () => {
    await cozinha.getByRole('region', { name: 'Em preparo' }).locator('article', { hasText: 'Mesa 8' }).getByRole('button', { name: 'Pronto' }).click();
    await cozinha.locator('article', { hasText: 'ACRÉSCIMO' }).getByRole('button', { name: 'Pronto' }).click();
    await expect(atendente.getByRole('button', { name: 'Entregue na mesa' })).toHaveCount(2);
    await expect(caixa.getByRole('button', { name: /^Mesa 8, pedido/ })).toContainText('2 pronto');
    await atendente.getByRole('button', { name: 'Entregue na mesa' }).first().click();
    await expect(atendente.getByRole('button', { name: 'Entregue na mesa' })).toHaveCount(1);
    await atendente.getByRole('button', { name: 'Entregue na mesa' }).click();
    await expect(atendente.getByText(/^Entregue \d\d:\d\d$/)).toHaveCount(2);
    await expect(caixa.getByRole('button', { name: /^Mesa 8, pedido/ })).toContainText('2 entregue');
    // entregues saem da coluna "prontos" da cozinha
    await expect(cozinha.locator('article', { hasText: 'Mesa 8' })).toHaveCount(0);
    await shot(atendente, 'w05-atendente-entregue');
  });

  test('atendente pede a conta; caixa é avisado, recebe e fecha', async () => {
    await atendente.getByRole('button', { name: 'Pedir a conta' }).click();
    await atendente.getByRole('dialog').getByRole('button', { name: 'Pedir a conta' }).click();
    await expect(atendente.getByText(/Conta pedida ao caixa às/)).toBeVisible();
    await expect(caixa.getByText(/Mesa 8 pediu a conta/)).toBeVisible();
    await expect(caixa.getByRole('button', { name: /^Mesa 8, pedido .*conta pedida/ })).toBeVisible();
    await shot(caixa, 'w06-caixa-conta-pedida');
    await caixa.getByRole('button', { name: /^Mesa 8, pedido/ }).click();
    await expect(caixa.locator('.drawer')).toContainText('lançado por Atendente Ana (demo)');
    await caixa.getByRole('button', { name: 'Receber R$ 51,80' }).click();
    const dlg = caixa.getByRole('dialog', { name: /Receber/ });
    await dlg.getByRole('button', { name: 'Cartão de débito' }).click();
    await dlg.getByRole('button', { name: /^Registrar R\$ 51,80/ }).click();
    await expect(caixa.getByText('Pagamento registrado')).toBeVisible();
    await caixa.getByRole('button', { name: 'Finalizar pedido' }).click();
    await expect(caixa.locator('.drawer .badge', { hasText: 'Finalizado' })).toBeVisible();
    await shot(caixa, 'w07-caixa-finalizado');
    await expect(atendente.getByText('Este pedido está finalizado.')).toBeVisible();
    await caixa.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(caixa.getByRole('button', { name: 'Mesa 8, livre' })).toBeVisible();
  });

  test('queda de conexão: o pedido não aparece como enviado; reenvio sem duplicar; caixa é avisado', async () => {
    await atendente.goto('/atendente');
    await atendente.getByRole('button', { name: /^Mesa 9/ }).click();
    await atendente.getByRole('button', { name: 'Adicionar produtos' }).click();
    await atendente.getByRole('button', { name: 'X-Burguer', exact: true }).click();
    await atendente.getByRole('button', { name: /^Adicionar · / }).click();
    await atendenteCtx.setOffline(true);
    await expect(atendente.getByRole('alert').filter({ hasText: 'Sem conexão' })).toBeVisible();
    await atendente.getByRole('button', { name: 'Conferir e enviar (1)' }).click();
    await atendente.getByRole('button', { name: 'Enviar para a cozinha' }).click();
    await expect(atendente.getByText('Envio não confirmado.').first()).toBeVisible();
    await expect(atendente.getByText(/Recebido pelo servidor/)).toHaveCount(0);
    await atendente.getByRole('dialog').getByRole('button', { name: 'Voltar' }).click();
    await shot(atendente, 'w08-atendente-falha');
    // o caixa vê que o celular caiu e a mesa 9 continua livre
    await expect(caixa.getByText(/Atendente Ana \(demo\).*perdeu a conexão/)).toBeVisible({ timeout: 20000 });
    await expect(caixa.getByRole('button', { name: 'Mesa 9, livre' })).toBeVisible();
    await shot(caixa, 'w09-caixa-aparelho-caiu');

    await atendenteCtx.setOffline(false);
    await expect(atendente.getByText('Online', { exact: true })).toBeVisible({ timeout: 15000 });
    await atendente.getByRole('button', { name: 'Reenviar agora' }).click();
    await expect(atendente.getByText(/Recebido pelo servidor às .* rodada 1/)).toBeVisible();
    await expect(caixa.getByRole('button', { name: /^Mesa 9, pedido/ })).toBeVisible();
    const open = await (await caixa.request.get('/api/orders?type=table&status=open')).json();
    expect(open.filter((o: any) => o.tableLabel === '9')).toHaveLength(1);
  });

  test('resposta perdida após o servidor gravar + toque repetido: nada duplicado', async () => {
    const id = atendente.url().split('/').pop()!;
    // o servidor recebe e grava, mas a resposta nunca chega ao celular
    let dropped = false;
    await atendente.route('**/api/orders/*/items', async (route) => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await atendente.getByRole('button', { name: 'Adicionar produtos' }).click();
    await atendente.getByRole('button', { name: 'X-Tudo', exact: true }).click();
    await atendente.getByRole('button', { name: /^Adicionar · / }).click();
    await atendente.getByRole('button', { name: 'Conferir e enviar (1)' }).click();
    await atendente.getByRole('button', { name: 'Enviar para a cozinha' }).click();
    await expect(atendente.getByRole('dialog').getByText(/não recebemos a confirmação/)).toBeVisible();
    // reenvio com toque duplo
    await atendente.getByRole('button', { name: 'Reenviar para a cozinha' }).dblclick();
    await expect(atendente.getByText(/Recebido pelo servidor às .* rodada 2/)).toBeVisible();
    await atendente.unroute('**/api/orders/*/items');
    const o = await (await caixa.request.get(`/api/orders/${id}`)).json();
    expect(o.items.filter((i: any) => i.productName === 'X-Tudo')).toHaveLength(1);
    expect(o.tickets).toHaveLength(2);
    await expect(cozinha.locator('article', { hasText: 'Mesa 9' })).toHaveCount(2);

    // toque repetido no envio normal
    await atendente.getByRole('button', { name: 'Adicionar produtos' }).click();
    await atendente.getByRole('button', { name: 'X-Egg Burguer', exact: true }).click();
    await atendente.getByRole('button', { name: /^Adicionar · / }).click();
    await atendente.getByRole('button', { name: 'Conferir e enviar (1)' }).click();
    const send = atendente.getByRole('button', { name: 'Enviar para a cozinha' });
    await send.dblclick();
    await expect(atendente.getByText(/rodada 3/)).toBeVisible();
    const o2 = await (await caixa.request.get(`/api/orders/${id}`)).json();
    expect(o2.items.filter((i: any) => i.productName === 'X-Egg Burguer')).toHaveLength(1);
    expect(o2.tickets).toHaveLength(3);
    void orderId;
  });
});
