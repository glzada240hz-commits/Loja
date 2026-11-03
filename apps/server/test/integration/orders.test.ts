import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { autoImportOfficialMenu } from '../../src/services/menu.js';
import { as, idemKey, menuIndex, openStore, resetDb, startApp, type Client, type MenuIndex } from '../helpers.js';

let h: Awaited<ReturnType<typeof startApp>>;
let caixa: Client;
let gerente: Client;
let m: MenuIndex;

beforeAll(async () => {
  h = await startApp();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDb(h);
  gerente = await openStore(h);
  caixa = await as(h, 'caixa');
  m = await menuIndex(caixa);
});

async function stockOf(c: Client, name: string): Promise<string> {
  const list = (await c.get('/api/stock')).body as { name: string; quantity: string }[];
  return list.find((x) => x.name === name)!.quantity;
}

function bigOrder(extra: Record<string, unknown> = {}) {
  return {
    type: 'counter',
    customer: { name: 'Maria Teste', phone: '(11) 98888-7777' },
    notes: 'Cliente aguarda no balcão',
    items: [
      {
        variantId: m.variant('X-Bacon'),
        quantity: 2,
        options: [
          { optionId: m.option('Cheddar'), quantity: 1 },
          { optionId: m.option('Sem cebola'), quantity: 1 },
        ],
        notes: 'bem passado',
      },
      { variantId: m.variant('Batata com cheddar e bacon'), quantity: 1 },
      { variantId: m.variant('Refrigerante lata'), quantity: 1 },
    ],
    ...extra,
  };
}

describe('1. pedido com vários itens, adicionais e observações', () => {
  it('calcula no servidor e grava retrato dos itens', async () => {
    const r = await caixa.post('/api/orders', bigOrder({ items: bigOrder().items.map((i) => ({ ...i, priceCents: 1 })) }));
    expect(r.status).toBe(200);
    const o = r.body;
    expect(o.number).toBe(1);
    expect(o.subtotalCents).toBe(2 * (1890 + 400) + 4090 + 600);
    expect(o.totalCents).toBe(9270);
    const bacon = o.items.find((i: any) => i.productName === 'X-Bacon');
    expect(bacon.unitPriceCents).toBe(1890);
    expect(bacon.optionsUnitCents).toBe(400);
    expect(bacon.totalCents).toBe(4580);
    expect(bacon.notes).toBe('bem passado');
    expect(bacon.options.map((x: any) => x.optionName).sort()).toEqual(['Cheddar', 'Sem cebola']);
    expect(o.notes).toBe('Cliente aguarda no balcão');
    expect(o.createdByName).toBe('Caixa Demo');
    // itens de cozinha num ticket; bebida não vai para a cozinha
    expect(o.tickets).toHaveLength(1);
    expect(o.items.find((i: any) => i.productName === 'Refrigerante lata').ticketId).toBeNull();
    expect(o.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['created', 'items.sent']));
  });

  it('valida mínimo/máximo de adicionais e disponibilidade', async () => {
    const many = ['Cheddar', 'Bacon extra', 'Ovo extra'].map((n) => ({ optionId: m.option(n), quantity: 2 }));
    const r = await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: m.variant('X-Burguer'), quantity: 1, options: many }] });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/no máximo 5/);
    await gerente.post('/api/menu/availability', { target: 'option', id: m.option('Cheddar'), available: false });
    const r2 = await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: m.variant('X-Burguer'), quantity: 1, options: [{ optionId: m.option('Cheddar'), quantity: 1 }] }] });
    expect(r2.status).toBe(422);
    expect(r2.body.error.message).toMatch(/indisponível/);
  });
});

describe('2. entrega, desconto e total', () => {
  it('taxa separada, desconto só sobre itens e limite do caixa', async () => {
    const base = bigOrder({
      type: 'delivery',
      address: { street: 'Rua das Flores', number: '10', neighborhoodId: m.neighborhood('Centro'), reference: 'portão azul' },
    });
    const ok = await caixa.post('/api/orders', { ...base, discount: { type: 'percent', value: 1000, reason: 'Cliente frequente' } });
    expect(ok.status).toBe(200);
    expect(ok.body.subtotalCents).toBe(9270);
    expect(ok.body.discountCents).toBe(927);
    expect(ok.body.deliveryFeeCents).toBe(500);
    expect(ok.body.totalCents).toBe(9270 - 927 + 500);
    expect(ok.body.neighborhoodName).toBe('Centro');

    // 20% excede o limite do caixa (10%): exige gerente
    const over = await caixa.post('/api/orders', { ...base, confirmDuplicate: true, discount: { type: 'percent', value: 2000, reason: 'Reclamação' } });
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe('supervisor_required');
    const wrongSup = await caixa.post('/api/orders', {
      ...base,
      confirmDuplicate: true,
      discount: { type: 'percent', value: 2000, reason: 'Reclamação' },
      supervisor: { username: 'cozinha', password: 'demo1234' },
    });
    expect(wrongSup.status).toBe(403);
    const auth = await caixa.post('/api/orders', {
      ...base,
      confirmDuplicate: true,
      discount: { type: 'percent', value: 2000, reason: 'Reclamação' },
      supervisor: { username: 'gerente', password: 'demo1234' },
    });
    expect(auth.status).toBe(200);
    expect(auth.body.discountCents).toBe(1854);
    expect(auth.body.events[0].authorizedByName).toBe('Gerente Demo');

    // desconto em valor nunca passa do subtotal e não incide sobre a entrega
    const big = await gerente.put(`/api/orders/${auth.body.id}/discount`, { version: auth.body.version, discount: { type: 'amount', value: 999999, reason: 'Cortesia' } });
    expect(big.status).toBe(200);
    expect(big.body.discountCents).toBe(9270);
    expect(big.body.totalCents).toBe(500);
  });

  it('desconto sem motivo é recusado e taxa manual exige permissão', async () => {
    const r = await caixa.post('/api/orders', { ...bigOrder(), discount: { type: 'amount', value: 100, reason: '' } });
    expect(r.status).toBe(400);
    const fee = await caixa.post('/api/orders', {
      ...bigOrder({ type: 'delivery', address: { street: 'Rua A', number: '1', neighborhoodId: m.neighborhood('Centro') } }),
      deliveryFeeCents: 0,
    });
    expect(fee.status).toBe(403);
    expect(fee.body.error.code).toBe('supervisor_required');
  });
});

describe('3. pagamento dividido e troco', () => {
  it('combina Pix, cartão e dinheiro com troco exato', async () => {
    const o = (await caixa.post('/api/orders', bigOrder())).body;
    const split = await caixa.get(`/api/orders/${o.id}/split?ways=3`);
    expect(split.body.parts).toEqual([3090, 3090, 3090]);
    const p1 = await caixa.post(`/api/orders/${o.id}/payments`, { method: 'pix_manual', amountCents: 3090, payerLabel: 'Pessoa 1' }, { 'idempotency-key': idemKey() });
    expect(p1.status).toBe(200);
    const p2 = await caixa.post(`/api/orders/${o.id}/payments`, { method: 'credit', amountCents: 3090, payerLabel: 'Pessoa 2' }, { 'idempotency-key': idemKey() });
    expect(p2.body.result.balanceCents).toBe(3090);
    // cartão não aceita valor acima do saldo
    const over = await caixa.post(`/api/orders/${o.id}/payments`, { method: 'debit', amountCents: 5000 });
    expect(over.status).toBe(422);
    const p3 = await caixa.post(`/api/orders/${o.id}/payments`, { method: 'cash', amountCents: 3090, tenderedCents: 5000, payerLabel: 'Pessoa 3' }, { 'idempotency-key': idemKey() });
    expect(p3.body.result).toMatchObject({ appliedCents: 3090, changeCents: 1910, balanceCents: 0 });
    expect(p3.body.order.paidCents).toBe(9270);
    const quitado = await caixa.post(`/api/orders/${o.id}/payments`, { method: 'cash', amountCents: 100 });
    expect(quitado.status).toBe(409);

    const cash = (await gerente.get('/api/cash')).body;
    expect(cash.summary.expectedCash).toBe(10000 + 3090); // troco não fica na gaveta
    expect(cash.summary.byMethod.pix_manual.net).toBe(3090);
    expect(cash.summary.byMethod.credit.net).toBe(3090);
    // conferência cega: o caixa não vê o esperado
    const blind = (await caixa.get('/api/cash')).body;
    expect(blind.summary.expectedCash).toBeNull();
  });

  it('Pix integrado não confirma pagamento sem provedor', async () => {
    const o = (await caixa.post('/api/orders', bigOrder())).body;
    const r = await caixa.post(`/api/orders/${o.id}/payments`, { method: 'pix_integrated', amountCents: 1000 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('not_configured');
  });

  it('não fecha com saldo devedor; conta pendente exige gerente', async () => {
    const o = (await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: m.variant('Refrigerante lata'), quantity: 1 }] })).body;
    const r = await caixa.post(`/api/orders/${o.id}/close`, { version: o.version });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('balance_due');
    const r2 = await caixa.post(`/api/orders/${o.id}/close`, { version: o.version, receivable: true });
    expect(r2.status).toBe(403);
    const r3 = await caixa.post(`/api/orders/${o.id}/close`, { version: o.version, receivable: true, supervisor: { username: 'gerente', password: 'demo1234' } });
    expect(r3.status).toBe(200);
    expect(r3.body.receivable).toBe(true);
    const pend = (await caixa.get('/api/orders?receivable=1')).body;
    expect(pend.map((x: any) => x.id)).toContain(o.id);
    // pagamento posterior quita a conta pendente
    const pay = await caixa.post(`/api/orders/${o.id}/payments`, { method: 'pix_manual', amountCents: 600 });
    expect(pay.status).toBe(200);
    expect((await caixa.get('/api/orders?receivable=1')).body.map((x: any) => x.id)).not.toContain(o.id);
  });
});

describe('4. cancelamento: efeitos em caixa e estoque', () => {
  it('estorna pagamentos, devolve itens não produzidos e registra perda dos produzidos', async () => {
    const pao0 = await stockOf(gerente, 'Pão de hambúrguer');
    const refri0 = await stockOf(gerente, 'Refrigerante lata');
    const o1 = (await caixa.post('/api/orders', bigOrder())).body;
    expect(await stockOf(gerente, 'Pão de hambúrguer')).toBe((Number(pao0) - 2).toFixed(3));
    expect(await stockOf(gerente, 'Refrigerante lata')).toBe((Number(refri0) - 1).toFixed(3));
    await caixa.post(`/api/orders/${o1.id}/payments`, { method: 'cash', amountCents: 5000, tenderedCents: 5000 });
    // um segundo pedido que a cozinha já começou
    const o2 = (await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] })).body;
    const kitchen = await as(h, 'cozinha');
    expect((await kitchen.post(`/api/kitchen/tickets/${o2.tickets[0].id}/status`, { status: 'preparing' })).status).toBe(200);

    // caixa não cancela sozinho
    const noPerm = await caixa.post(`/api/orders/${o1.id}/cancel`, { version: o1.version, reason: 'Cliente desistiu' });
    expect(noPerm.status).toBe(403);
    const fresh1 = (await caixa.get(`/api/orders/${o1.id}`)).body;
    const needRefund = await gerente.post(`/api/orders/${o1.id}/cancel`, { version: fresh1.version, reason: 'Cliente desistiu' });
    expect(needRefund.status).toBe(409);
    expect(needRefund.body.error.code).toBe('payments_exist');
    const c1 = await caixa.post(`/api/orders/${o1.id}/cancel`, {
      version: fresh1.version,
      reason: 'Cliente desistiu',
      refundPayments: true,
      supervisor: { username: 'gerente', password: 'demo1234' },
    });
    expect(c1.status).toBe(200);
    expect(c1.body.status).toBe('cancelled');
    expect(c1.body.paidCents).toBe(0);
    expect(c1.body.payments[0].status).toBe('refunded');
    expect(c1.body.cancelReason).toBe('Cliente desistiu');
    const cancelEvent = c1.body.events.find((e: any) => e.type === 'cancelled');
    expect(cancelEvent.userName).toBe('Caixa Demo');
    expect(cancelEvent.authorizedByName).toBe('Gerente Demo');
    // itens não iniciados voltam ao estoque
    expect(await stockOf(gerente, 'Pão de hambúrguer')).toBe((Number(pao0) - 1).toFixed(3)); // só o X-Burguer do o2 segue baixado
    expect(await stockOf(gerente, 'Refrigerante lata')).toBe(Number(refri0).toFixed(3));
    const cash = (await gerente.get('/api/cash')).body;
    expect(cash.summary.expectedCash).toBe(10000);
    expect(cash.summary.byMethod.cash).toEqual({ received: 5000, refunded: 5000, net: 0 });

    // cancelamento do pedido já em preparo: estoque não volta, perda é registrada
    const c2 = await gerente.post(`/api/orders/${o2.id}/cancel`, { version: o2.version, reason: 'Erro de lançamento' });
    expect(c2.status).toBe(200);
    expect(await stockOf(gerente, 'Pão de hambúrguer')).toBe((Number(pao0) - 1).toFixed(3));
    const movs = (await gerente.get('/api/stock/movements')).body as any[];
    expect(movs.filter((x) => x.type === 'loss' && x.itemName === 'Pão de hambúrguer')).toHaveLength(1);
    // cancelar de novo não duplica estornos
    const again = await gerente.post(`/api/orders/${o2.id}/cancel`, { version: c2.body.version, reason: 'de novo' });
    expect(again.status).toBe(409);
    // relatório separa cancelados
    const rep = (await gerente.get(`/api/reports/sales?from=2000-01-01&to=2100-01-01`)).body;
    expect(rep.summary.orders).toBe(0);
    expect(rep.summary.cancelledCount).toBe(2);
  });

  it('cancelar item enviado exige gerente e recalcula', async () => {
    const o = (await caixa.post('/api/orders', bigOrder())).body;
    const item = o.items.find((i: any) => i.productName === 'Refrigerante lata');
    const r = await caixa.post(`/api/orders/${o.id}/items/${item.id}/cancel`, { version: o.version, reason: 'trocou' });
    expect(r.status).toBe(403);
    const r2 = await caixa.post(`/api/orders/${o.id}/items/${item.id}/cancel`, { version: o.version, reason: 'trocou', supervisor: { username: 'gerente', password: 'demo1234' } });
    expect(r2.status).toBe(200);
    expect(r2.body.totalCents).toBe(9270 - 600);
  });
});

describe('8. alteração de preço não muda pedidos antigos', () => {
  it('mantém retrato de preço e nome', async () => {
    const old = (await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: m.variant('X-Burguer'), quantity: 1, options: [{ optionId: m.option('Cheddar'), quantity: 1 }] }] })).body;
    expect(old.totalCents).toBe(1750);
    const menu = (await gerente.get('/api/menu')).body as any[];
    const prod = menu.flatMap((c) => c.products).find((p: any) => p.name === 'X-Burguer');
    const upd = await gerente.post('/api/menu/products', {
      id: prod.id,
      categoryId: prod.categoryId,
      name: 'X-Burguer Especial',
      code: prod.code,
      variants: [{ id: prod.variants[0].id, name: 'Único', priceCents: 1490 }],
      groupIds: prod.groups.map((g: any) => g.id),
    });
    expect(upd.status).toBe(200);
    const grp = (await gerente.get('/api/menu/groups')).body.find((g: any) => g.name === 'Adicionais');
    await gerente.post('/api/menu/groups', { id: grp.id, name: grp.name, minSelect: 0, maxSelect: 5, options: grp.options.map((o: any) => ({ id: o.id, name: o.name, priceCents: o.name === 'Cheddar' ? 500 : o.priceCents })) });

    const reread = (await caixa.get(`/api/orders/${old.id}`)).body;
    expect(reread.items[0].productName).toBe('X-Burguer');
    expect(reread.items[0].unitPriceCents).toBe(1350);
    expect(reread.items[0].options[0].priceCents).toBe(400);
    expect(reread.totalCents).toBe(1750);
    const neu = (await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: prod.variants[0].id, quantity: 1, options: [{ optionId: m.option('Cheddar'), quantity: 1 }] }] })).body;
    expect(neu.items[0].productName).toBe('X-Burguer Especial');
    expect(neu.totalCents).toBe(1990);
    // editar o pedido antigo (ex.: observação) não reprecifica
    const ed = await caixa.patch(`/api/orders/${old.id}`, { version: reread.version, notes: 'sem pressa' });
    expect(ed.body.totalCents).toBe(1750);
  });
});

describe('9. cliques repetidos e requisições duplicadas', () => {
  it('mesma chave = um pedido; chave reutilizada com outro conteúdo = erro', async () => {
    const key = idemKey();
    const body = bigOrder();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => caixa.post('/api/orders', body, { 'idempotency-key': key })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    const list = (await caixa.get('/api/orders')).body;
    expect(list).toHaveLength(1);
    const diff = await caixa.post('/api/orders', { ...body, notes: 'outro' }, { 'idempotency-key': key });
    expect(diff.status).toBe(422);
  });

  it('pagamento repetido com a mesma chave não cobra duas vezes', async () => {
    const o = (await caixa.post('/api/orders', bigOrder())).body;
    const key = idemKey();
    const pay = { method: 'cash', amountCents: 2000, tenderedCents: 2000 };
    const rs = await Promise.all([1, 2, 3].map(() => caixa.post(`/api/orders/${o.id}/payments`, pay, { 'idempotency-key': key })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const after = (await caixa.get(`/api/orders/${o.id}`)).body;
    expect(after.payments).toHaveLength(1);
    expect(after.paidCents).toBe(2000);
  });

  it('alerta de possível duplicidade sem bloquear pedido legítimo', async () => {
    await caixa.post('/api/orders', bigOrder());
    const dup = await caixa.post('/api/orders', bigOrder());
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('possible_duplicate');
    expect(dup.body.error.details.number).toBe(1);
    const ok = await caixa.post('/api/orders', { ...bigOrder(), confirmDuplicate: true });
    expect(ok.status).toBe(200);
    expect(ok.body.number).toBe(2);
    // pedido diferente do mesmo cliente não alerta
    const other = await caixa.post('/api/orders', { ...bigOrder(), items: [{ variantId: m.variant('X-Tudo'), quantity: 1 }] });
    expect(other.status).toBe(200);
  });

  it('mesa já ocupada não abre segunda comanda', async () => {
    const a = await caixa.post('/api/orders', { type: 'table', tableLabel: '5', items: [{ variantId: m.variant('Refrigerante lata'), quantity: 2 }] });
    expect(a.status).toBe(200);
    const b = await caixa.post('/api/orders', { type: 'table', tableLabel: '5', items: [{ variantId: m.variant('Refrigerante lata'), quantity: 1 }] });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('table_busy');
  });
});

describe('comanda, reabertura e histórico', () => {
  it('adiciona rodadas, fecha, reabre com auditoria', async () => {
    const o = (await caixa.post('/api/orders', { type: 'table', tableLabel: '3', items: [{ variantId: m.variant('X-Egg Burguer'), quantity: 1 }] })).body;
    const r2 = await caixa.post(`/api/orders/${o.id}/items`, { version: o.version, items: [{ variantId: m.variant('Batata frita'), quantity: 1 }] });
    expect(r2.status).toBe(200);
    expect(r2.body.tickets).toHaveLength(2);
    expect(r2.body.totalCents).toBe(1550 + 2290);
    // versão antiga é recusada (edição concorrente)
    const stale = await caixa.post(`/api/orders/${o.id}/items`, { version: o.version, items: [{ variantId: m.variant('Batata frita'), quantity: 1 }] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_version');
    const k = await as(h, 'cozinha');
    for (const t of r2.body.tickets) await k.post(`/api/kitchen/tickets/${t.id}/status`, { status: 'ready' });
    await caixa.post(`/api/orders/${o.id}/payments`, { method: 'debit', amountCents: 3840 });
    const cur = (await caixa.get(`/api/orders/${o.id}`)).body;
    expect(cur.stage).toBe('ready');
    const closed = await caixa.post(`/api/orders/${o.id}/close`, { version: cur.version });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed');
    const edit = await caixa.patch(`/api/orders/${o.id}`, { version: closed.body.version, notes: 'x' });
    expect(edit.status).toBe(409);
    const reopenNoPerm = await caixa.post(`/api/orders/${o.id}/reopen`, { reason: 'esqueceu item' });
    expect(reopenNoPerm.status).toBe(403);
    const reopen = await caixa.post(`/api/orders/${o.id}/reopen`, { reason: 'esqueceu item', supervisor: { username: 'gerente', password: 'demo1234' } });
    expect(reopen.status).toBe(200);
    expect(reopen.body.status).toBe('open');
    const types = reopen.body.events.map((e: any) => e.type);
    expect(types).toEqual(expect.arrayContaining(['created', 'items.added', 'kitchen', 'payment', 'closed', 'reopened']));
    const audit = (await (await as(h, 'admin')).get('/api/audit?entity=order')).body;
    expect(audit.some((a: any) => a.action === 'order.reopen' && a.authorizedByName === 'Gerente Demo')).toBe(true);
  });

  it('pesquisa por número, nome, telefone e endereço', async () => {
    await caixa.post('/api/orders', {
      ...bigOrder({ type: 'delivery', customer: { name: 'João Pesquisa', phone: '11 97777-1234' }, address: { street: 'Avenida Brasil', number: '500', neighborhoodId: m.neighborhood('Vila Nova') } }),
    });
    for (const q of ['1', 'joão', '1234', 'brasil', 'vila nova']) {
      const r = await caixa.get('/api/orders?q=' + encodeURIComponent(q));
      expect(r.body.length, q).toBe(1);
    }
    expect((await caixa.get('/api/orders?q=inexistente')).body).toHaveLength(0);
  });
});

describe('item do estoque à venda', () => {
  it('cadastrado no estoque e posto à venda aparece no cardápio das mesas e cada venda baixa o estoque', async () => {
    const item = (await gerente.post('/api/stock', { name: 'Cerveja long neck', unit: 'un', minQuantity: '6', unitCostCents: '450' })).body;
    await gerente.post('/api/stock/movements', { stockItemId: item.id, type: 'entry', quantity: '24', reason: 'Estoque inicial' });
    // antes de pôr à venda: não aparece para vender
    const names = async () => ((await caixa.get('/api/menu')).body as { products: { name: string }[] }[]).flatMap((c) => c.products.map((p) => p.name));
    expect(await names()).not.toContain('Cerveja long neck');

    const cat = ((await caixa.get('/api/menu')).body as { id: string; name: string }[]).find((c) => c.name === 'Bebidas')!;
    expect((await caixa.post(`/api/stock/${item.id}/sell`, { categoryId: cat.id, priceCents: 1200 })).status).toBe(403); // caixa não mexe no cardápio
    const sold = await gerente.post(`/api/stock/${item.id}/sell`, { categoryId: cat.id, priceCents: 1200, code: '77' });
    expect(sold.status).toBe(200);
    expect(sold.body.variant.costCents).toBe(450);
    expect(await names()).toContain('Cerveja long neck');
    expect(((await gerente.get('/api/stock')).body as { name: string; soldAs: string[] }[]).find((x) => x.name === 'Cerveja long neck')!.soldAs).toEqual(['Cerveja long neck']);
    // código repetido é recusado
    expect((await gerente.post(`/api/stock/${item.id}/sell`, { categoryId: cat.id, priceCents: 1200, code: '77' })).status).toBe(422);

    // venda numa mesa baixa 3 unidades
    const r = await caixa.post('/api/orders', { type: 'table', tableLabel: '3', send: true, items: [{ variantId: sold.body.variant.id, quantity: 3 }] }, { 'idempotency-key': idemKey() });
    expect(r.status).toBe(200);
    expect(r.body.totalCents).toBe(3600);
    expect(Number(await stockOf(gerente, 'Cerveja long neck'))).toBe(21);
  });
});

describe('cardápio oficial do Bar do Guto', () => {
  it('importa com os preços das artes, tira os exemplos, mantém o que o dono cadastrou e pode repetir sem duplicar', async () => {
    // item que o dono pôs à venda pelo estoque continua
    const item = (await gerente.post('/api/stock', { name: 'Gelo', unit: 'un', minQuantity: '0' })).body;
    const bebidas = ((await caixa.get('/api/menu')).body as { id: string; name: string }[]).find((c) => c.name === 'Bebidas')!;
    await gerente.post(`/api/stock/${item.id}/sell`, { categoryId: bebidas.id, priceCents: 300 });

    expect((await caixa.post('/api/menu/import-official', {})).status).toBe(403);
    const r = await gerente.post('/api/menu/import-official', { archiveExamples: true, updateStore: true });
    expect(r.status).toBe(200);
    expect(r.body.archived).toEqual(expect.arrayContaining(['X-Bacon', 'Batata frita', 'Combo X-Burguer + Batata + Refri']));
    expect(r.body.kept).toEqual(['Gelo']);
    expect(r.body.codesSkipped).toEqual([]);

    const menu = (await caixa.get('/api/menu')).body as { name: string; sendToKitchen: boolean; products: { name: string; code: string; description: string; variants: { name: string; priceCents: number }[] }[] }[];
    const all = menu.flatMap((c) => c.products);
    expect(all).toHaveLength(48); // 47 do cardápio + Gelo
    const p = (n: string) => all.find((x) => x.name === n)!;
    expect(p('X-Burguer')).toMatchObject({ code: '1', description: 'Pão, carne, presunto, muçarela e salada.' });
    expect(p('X-Burguer').variants.map((v) => v.priceCents)).toEqual([1350]);
    expect(p('X-Picanha').variants[0]!.priceCents).toBe(2590);
    expect(p('Contra Filé c/ Fritas').variants[0]!.priceCents).toBe(6490);
    expect(p('Heineken').variants.map((v) => [v.name, v.priceCents])).toEqual([['600ml', 1600], ['Long neck', 1200]]);
    expect(p('Refrigerante Lata').variants[0]!.priceCents).toBe(800);
    expect(p('Whisky').variants[0]!.priceCents).toBe(2000);
    expect(all.find((x) => x.name === 'X-Bacon')).toBeUndefined();
    expect(menu.map((c) => c.name)).toEqual(['Hambúrgueres', 'Porções', 'Pratos', 'Cervejas', 'Drinks e doses', 'Refrigerantes e sucos', 'Bebidas']);
    expect(menu.find((c) => c.name === 'Cervejas')!.sendToKitchen).toBe(false);
    expect(menu.find((c) => c.name === 'Hambúrgueres')!.sendToKitchen).toBe(true);
    expect((await caixa.get('/api/settings')).body.storePhone).toBe('(31) 98841-4429');

    // repetir não duplica
    const again = await gerente.post('/api/menu/import-official', { archiveExamples: true, updateStore: false });
    expect(again.body.created).toEqual([]);
    expect(((await caixa.get('/api/menu')).body as { products: unknown[] }[]).flatMap((c) => c.products)).toHaveLength(48);

    // venda: Heineken long neck + X-Tudo sem milho, na mesa
    const heinekenLN = (await caixa.get('/api/menu')).body.flatMap((c: any) => c.products).find((x: any) => x.name === 'Heineken').variants.find((v: any) => v.name === 'Long neck').id;
    const xtudo = (await caixa.get('/api/menu')).body.flatMap((c: any) => c.products).find((x: any) => x.name === 'X-Tudo');
    const semMilho = xtudo.groups.flatMap((g: any) => g.options).find((o: any) => o.name === 'Sem milho').id;
    const o = await caixa.post('/api/orders', { type: 'table', tableLabel: '2', send: true, items: [{ variantId: heinekenLN, quantity: 2 }, { variantId: xtudo.variants[0].id, quantity: 1, options: [{ optionId: semMilho, quantity: 1 }] }] }, { 'idempotency-key': idemKey() });
    expect(o.status).toBe(200);
    expect(o.body.totalCents).toBe(2 * 1200 + 2190);
  });
});

describe('cardápio oficial automático (modo loja)', () => {
  it('na primeira abertura coloca o cardápio sozinho, uma única vez; mudanças da loja depois são mantidas', async () => {
    const first = await autoImportOfficialMenu(h.deps);
    expect(first).not.toBeNull();
    expect(first!.storeUpdated).toBe(true); // telefone/endereço eram os de exemplo
    const find = async (n: string) => ((await caixa.get('/api/menu')).body as any[]).flatMap((c) => c.products).find((p: any) => p.name === n);
    expect((await find('Contra Filé c/ Fritas')).variants[0].priceCents).toBe(6490);
    expect(await find('X-Bacon')).toBeUndefined();
    expect((await gerente.get('/api/menu/official')).body.imported).toBe(true);

    // a loja muda um preço; reabrir o sistema não desfaz
    const xb = await find('X-Burguer');
    await gerente.post('/api/menu/products', { id: xb.id, categoryId: xb.categoryId, name: xb.name, code: xb.code, variants: [{ id: xb.variants[0].id, name: 'Único', priceCents: 1400 }] });
    expect(await autoImportOfficialMenu(h.deps)).toBeNull();
    expect((await find('X-Burguer')).variants[0].priceCents).toBe(1400);
  });
});

describe('autorização do gerente', () => {
  it('senha errada do gerente responde 403 (não derruba a sessão do caixa) e a certa autoriza', async () => {
    const o = await caixa.post('/api/orders', { type: 'counter', send: true, items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] }, { 'idempotency-key': idemKey() });
    const bad = await caixa.post(`/api/orders/${o.body.id}/cancel`, { version: o.body.version, reason: 'Teste', supervisor: { username: 'gerente', password: 'errada' } });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('supervisor_invalid');
    expect((await caixa.get('/api/auth/me')).status).toBe(200); // caixa continua logado
    const ok = await caixa.post(`/api/orders/${o.body.id}/cancel`, { version: o.body.version, reason: 'Teste', supervisor: { username: 'Gerente', password: 'demo1234' } });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('cancelled');
  });
});

describe('impressora da cozinha escolhida (fila para o BarDoGuto.exe)', () => {
  it('cada envio vira um arquivo para a impressora da cozinha, uma vez; cancelado avisa; o que existia antes não', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { startKitchenPrintAgent, readPrinterInfo } = await import('../../src/services/kitchenPrintAgent.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guto-print-'));
    const jobs = () => (fs.existsSync(path.join(dir, 'fila')) ? fs.readdirSync(path.join(dir, 'fila')).sort().map((f) => fs.readFileSync(path.join(dir, 'fila', f), 'utf8')) : []);
    const agent = startKitchenPrintAgent(h.deps, dir, { warn: () => undefined });
    try {
      // pedido feito antes de escolher a impressora: não imprime
      await caixa.post('/api/orders', { type: 'counter', send: true, items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] }, { 'idempotency-key': idemKey() });
      expect((await caixa.post('/api/system/kitchen-printer', { name: 'ELGIN i9 Cozinha' })).status).toBe(200);
      await agent.check();
      expect(jobs()).toHaveLength(0);

      const o = await caixa.post('/api/orders', { type: 'table', tableLabel: '4', send: true, items: [{ variantId: m.variant('X-Tudo'), quantity: 2, notes: 'bem passado' }] }, { 'idempotency-key': idemKey() });
      await agent.check();
      await agent.check(); // conferir de novo não duplica
      const [job] = jobs();
      expect(jobs()).toHaveLength(1);
      expect(job).toContain('IMPRESSORA\tELGIN i9 Cozinha');
      expect(job).toContain('T\tNOVO PEDIDO');
      expect(job).toContain(`B\t#${o.body.number}`);
      expect(job).toContain('P\tMESA 4');
      expect(job).toContain('I\t2x X-Tudo');
      expect(job).toContain('M\tOBS: bem passado');
      expect(job).not.toMatch(/R\$/);

      await caixa.post(`/api/orders/${o.body.id}/cancel`, { version: o.body.version, reason: 'Teste', supervisor: { username: 'gerente', password: 'demo1234' } });
      await agent.check();
      expect(jobs()).toHaveLength(2);
      expect(jobs()[1]).toContain('T\tCANCELADO — NÃO FAZER');

      // o aplicativo informa impressoras e resultado
      fs.writeFileSync(path.join(dir, 'impressoras.txt'), 'PADRAO\tEPSON Caixa\r\nIMPRESSORA\tEPSON Caixa\r\nIMPRESSORA\tELGIN i9 Cozinha\r\n');
      fs.writeFileSync(path.join(dir, 'estado.txt'), 'OK\t2026-11-03T20:00:00Z\tPedido #2');
      expect(readPrinterInfo(dir)).toMatchObject({ agent: true, defaultPrinter: 'EPSON Caixa', printers: ['EPSON Caixa', 'ELGIN i9 Cozinha'], last: { ok: true } });
    } finally {
      agent.stop();
      await caixa.post('/api/system/kitchen-printer', { name: '' });
    }
  });
});
