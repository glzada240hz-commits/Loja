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
