import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, as, idemKey, menuIndex, openStore, resetDb, setClock, startApp, type MenuIndex } from '../helpers.js';
import { processOutbox } from '../../src/whatsapp/outbox.js';

let h: Awaited<ReturnType<typeof startApp>>;
let m: MenuIndex;
let caixa: Client;
let gerente: Client;
let clock: Date;

beforeAll(async () => {
  h = await startApp();
});
afterAll(async () => {
  setClock(null);
  await h.close();
});
beforeEach(async () => {
  await resetDb(h);
  clock = new Date('2026-10-24T22:00:00Z'); // 19:00 em São Paulo
  setClock(() => clock);
  gerente = await openStore(h);
  caixa = await as(h, 'caixa');
  m = await menuIndex(caixa);
});

const advance = (min: number) => {
  clock = new Date(clock.getTime() + min * 60000);
};

async function publicCheckout(body: Record<string, unknown>, key = idemKey()) {
  return new Client(h.app).post('/api/public/orders', body, { 'idempotency-key': key });
}

function onlineOrder(phone: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'delivery',
    customer: { name: 'Cliente Online', phone },
    address: { street: 'Rua do Teste', number: '42', complement: 'apto 3', neighborhoodId: m.neighborhood('Centro') },
    items: [
      { variantId: m.variant('X-Cabuloso'), quantity: 1, options: [{ optionId: m.option('Cheddar'), quantity: 1 }], notes: 'sem pimenta' },
      { variantId: m.variant('Refrigerante lata'), quantity: 2 },
    ],
    paymentIntent: 'cash',
    changeForCents: 5000,
    waOptIn: true,
    privacyAccepted: true,
    ...extra,
  };
}

describe('6/7/16. cardápio digital → cozinha → entrega → acerto do entregador → fechamento do caixa', () => {
  it('fluxo completo', async () => {
    // cliente conversa antes no WhatsApp (abre janela de 24h)
    await gerente.post('/api/whatsapp/demo/inbound', { phone: '11 96666-5555', text: 'oi' });

    // --- cardápio digital ---
    const pub = new Client(h.app);
    const menu = (await pub.get('/api/public/menu')).body;
    expect(menu.store.open).toBe(true);
    expect(JSON.stringify(menu)).not.toMatch(/costCents":\d/); // nunca expõe custos
    // preço enviado pelo navegador é ignorado
    const r1 = await publicCheckout({ ...onlineOrder('11 96666-5555'), items: [{ variantId: m.variant('X-Cabuloso'), quantity: 1, priceCents: 1, options: [{ optionId: m.option('Cheddar'), quantity: 1 }], notes: 'sem pimenta' }, { variantId: m.variant('Refrigerante lata'), quantity: 2 }] });
    expect(r1.status).toBe(200);
    const token = r1.body.trackingToken;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const track = (await pub.get(`/api/public/orders/${token}`)).body;
    expect(track.status).toBe('pending');
    expect(track.totalCents).toBe(2390 + 400 + 1200 + 500);
    expect(track.addrStreet).toBeUndefined(); // rastreio não expõe endereço completo
    expect(track.customerFirstName).toBe('Cliente');

    // pedido ainda não confirmado não vai para a cozinha e a mensagem é honesta
    const k = await as(h, 'cozinha');
    expect((await k.get('/api/kitchen')).body.tickets).toHaveLength(0);
    await processOutbox(h.deps, h.wa);
    const sent1 = h.demo.sent.find((x) => /pedido #1 /.test(x.body))!;
    expect(sent1.body).toMatch(/ainda será CONFIRMADO/);
    expect(sent1.body).not.toMatch(/foi confirmado/);

    // segundo pedido online (outro cliente) para agrupar na mesma saída
    const r2 = await publicCheckout(onlineOrder('11 95555-4444', { items: [{ variantId: m.variant('X-Burguer'), quantity: 2 }], paymentIntent: 'pix_manual', changeForCents: null }));
    expect(r2.status).toBe(200);

    // --- aceite pelo caixa ---
    const pend = (await caixa.get('/api/orders?status=pending')).body;
    expect(pend).toHaveLength(2);
    for (const p of pend) {
      const acc = await caixa.post(`/api/orders/${p.id}/accept`, { version: p.version, etaMinutes: 40 });
      expect(acc.status).toBe(200);
      expect(acc.body.status).toBe('open');
      expect(acc.body.tickets).toHaveLength(1);
    }
    await processOutbox(h.deps, h.wa);
    const accepted = h.demo.sent.filter((s) => /foi confirmado pela loja/.test(s.body));
    expect(accepted).toHaveLength(1); // só o cliente com janela aberta recebe texto livre
    // o outro (fora da janela, sem template aprovado) fica registrado como falha, sem fingir envio
    const mon = (await gerente.get('/api/whatsapp/monitor')).body;
    expect(mon.failedMessages.some((x: any) => /janela de 24h/.test(x.error))).toBe(true);

    // --- cozinha ---
    const queue = (await k.get('/api/kitchen')).body.tickets;
    expect(queue).toHaveLength(2);
    const t1 = queue.find((t: any) => t.items.some((i: any) => i.productName === 'X-Cabuloso'));
    expect(t1.items[0].options[0].name).toBe('Cheddar');
    expect(t1.items[0].notes).toBe('sem pimenta');
    expect(t1.items.some((i: any) => i.productName === 'Refrigerante lata')).toBe(false);
    advance(5);
    await k.post(`/api/kitchen/tickets/${queue[0].id}/status`, { status: 'preparing' });
    expect((await pub.get(`/api/public/orders/${token}`)).body.stage).toMatch(/preparing|received/);
    advance(10);
    await k.post(`/api/kitchen/tickets/${queue[0].id}/status`, { status: 'ready' });
    // transição inválida
    expect((await k.post(`/api/kitchen/tickets/${queue[0].id}/status`, { status: 'bogus' })).status).toBe(400);

    // --- expedição ---
    const board = (await caixa.get('/api/deliveries')).body;
    expect(board.orders).toHaveLength(2);
    const couriers = (await caixa.get('/api/couriers')).body;
    const moto1 = couriers.find((c: any) => c.name.startsWith('Entregador 1'));
    const run = await caixa.post('/api/deliveries/assign', { orderIds: board.orders.map((o: any) => o.id), courierId: moto1.id });
    expect(run.status).toBe(200);
    // um dos pedidos ainda não está pronto
    const notReady = await caixa.post(`/api/deliveries/runs/${run.body.id}/depart`, {});
    expect(notReady.status).toBe(409);
    expect(notReady.body.error.code).toBe('not_ready');
    await k.post(`/api/kitchen/tickets/${queue[1].id}/status`, { status: 'ready' });
    advance(2);
    const dep = await caixa.post(`/api/deliveries/runs/${run.body.id}/depart`, {});
    expect(dep.status).toBe(200);
    expect((await pub.get(`/api/public/orders/${token}`)).body.stage).toBe('out_for_delivery');

    // --- visão do entregador ---
    const e1 = await as(h, 'moto1');
    const e2 = await as(h, 'moto2');
    const mine = (await e1.get('/api/courier/me')).body;
    expect(mine.deliveries).toHaveLength(2);
    const d1 = mine.deliveries.find((d: any) => d.customerPhone === '5511966665555');
    expect(d1.balanceCents).toBe(4490);
    expect(d1.changeForCents).toBe(5000);
    expect(Object.keys(d1)).not.toContain('events');
    expect((await e2.get('/api/courier/me')).body.deliveries).toHaveLength(0);
    // outro entregador não pode concluir entrega alheia; entregador não acessa pedidos
    expect((await e2.post(`/api/deliveries/${d1.id}/status`, { status: 'delivered' })).status).toBe(403);
    expect((await e1.get(`/api/orders/${d1.id}`)).status).toBe(403);
    expect((await e1.get('/api/orders')).status).toBe(403);

    advance(18);
    expect((await e1.post(`/api/deliveries/${d1.id}/status`, { status: 'delivered' })).status).toBe(200);
    const d2 = mine.deliveries.find((d: any) => d.id !== d1.id);
    expect((await e1.post(`/api/deliveries/${d2.id}/status`, { status: 'issue' })).status).toBe(422); // exige descrição
    expect((await e1.post(`/api/deliveries/${d2.id}/status`, { status: 'issue', note: 'Cliente não atende' })).status).toBe(200);
    advance(7);
    expect((await e1.post(`/api/deliveries/${d2.id}/status`, { status: 'delivered' })).status).toBe(200);

    // --- recebimento e fechamento dos pedidos ---
    for (const d of [d1, d2]) {
      const o = (await caixa.get(`/api/orders/${d.id}`)).body;
      const method = d.id === d1.id ? 'cash' : 'pix_manual';
      const pay = await caixa.post(`/api/orders/${o.id}/payments`, { method, amountCents: o.balanceCents, tenderedCents: method === 'cash' ? 5000 : undefined }, { 'idempotency-key': idemKey() });
      expect(pay.status).toBe(200);
      if (method === 'cash') expect(pay.body.result.changeCents).toBe(510);
      const cl = await caixa.post(`/api/orders/${o.id}/close`, { version: pay.body.order.version });
      expect(cl.status).toBe(200);
    }

    // --- acerto do entregador ---
    await gerente.post(`/api/couriers/${moto1.id}/adjustments`, { type: 'bonus', amountCents: 300, reason: 'Chuva' });
    await gerente.post(`/api/couriers/${moto1.id}/adjustments`, { type: 'deduction', amountCents: 100, reason: 'Adiantamento' });
    expect((await caixa.post(`/api/couriers/${moto1.id}/adjustments`, { type: 'bonus', amountCents: 1, reason: 'x' })).status).toBe(403);
    const pending = (await gerente.get(`/api/couriers/${moto1.id}/pending`)).body;
    expect(pending.deliveriesCount).toBe(2);
    expect(pending.feesCents).toBe(800); // repasse do bairro Centro: R$ 4,00 (taxa cobrada: R$ 5,00)
    expect(pending.totalCents).toBe(1000);
    const wrong = await gerente.post(`/api/couriers/${moto1.id}/settle`, { paidFromCash: true, expectedTotalCents: 999 });
    expect(wrong.status).toBe(409);
    const key = idemKey();
    const [s1, s2] = await Promise.all([
      gerente.post(`/api/couriers/${moto1.id}/settle`, { paidFromCash: true, expectedTotalCents: 1000 }, { 'idempotency-key': key }),
      gerente.post(`/api/couriers/${moto1.id}/settle`, { paidFromCash: true, expectedTotalCents: 1000 }, { 'idempotency-key': key }),
    ]);
    expect(s1.status).toBe(200);
    expect(s2.body.settlementId).toBe(s1.body.settlementId);
    expect((await gerente.post(`/api/couriers/${moto1.id}/settle`, { paidFromCash: true, expectedTotalCents: 0 })).status).toBe(409);
    expect((await gerente.get(`/api/couriers/${moto1.id}/pending`)).body.totalCents).toBe(0);

    // --- relatórios e fechamento do caixa ---
    const rep = (await gerente.get('/api/reports/sales?from=2026-10-24&to=2026-10-24')).body;
    expect(rep.summary.orders).toBe(2);
    expect(rep.summary.deliveryFeesCents).toBe(1000);
    expect(rep.couriers[0]).toMatchObject({ deliveries: 2, fees_owed: 800 });
    expect(rep.couriers[0].avg_minutes).toBe(Math.round((18 + 25) / 2));
    expect(rep.byNeighborhood[0]).toMatchObject({ neighborhood: 'Centro', orders: 2, fees: 1000 });

    const cash = (await gerente.get('/api/cash')).body;
    expect(cash.summary.expectedCash).toBe(10000 + 4490 - 1000);
    const bad = await gerente.post('/api/cash/close', { countedCashCents: 13000 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.differenceCents).toBe(-490);
    const ok = await gerente.post('/api/cash/close', { countedCashCents: 13000, justification: 'Faltou troco de R$ 4,90' });
    expect(ok.status).toBe(200);
    expect(ok.body.session.differenceCents).toBe(-490);
    expect(ok.body.summary.byMethod.pix_manual.net).toBe(2700 + 500);
    // caixa fechado: não aceita mais pagamentos nem sangria
    expect((await caixa.post('/api/cash/movements', { type: 'withdrawal', amountCents: 100, reason: 'x' })).status).toBe(409);
    expect((await gerente.post('/api/day/close', {})).status).toBe(200);
  });

  it('valida taxa, mínimo, disponibilidade e loja fechada no servidor', async () => {
    const below = await publicCheckout(onlineOrder('11 94444-3333', { address: { street: 'R', number: '1', neighborhoodId: m.neighborhood('Jardim das Flores') }, items: [{ variantId: m.variant('Refrigerante lata'), quantity: 1 }] }));
    expect(below.status).toBe(422);
    expect(below.body.error.code).toBe('below_minimum');
    await gerente.post('/api/menu/availability', { target: 'variant', id: m.variant('X-Cabuloso'), available: false });
    const unavailable = await publicCheckout(onlineOrder('11 94444-3333'));
    expect(unavailable.status).toBe(422);
    await gerente.put('/api/settings', { onlineOrdersEnabled: false });
    const paused = await publicCheckout(onlineOrder('11 94444-3333', { items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] }));
    expect(paused.status).toBe(409);
    expect(paused.body.error.code).toBe('store_closed');
    // sem aceite de privacidade é recusado
    await gerente.put('/api/settings', { onlineOrdersEnabled: true });
    const noPrivacy = await publicCheckout({ ...onlineOrder('11 94444-3333'), privacyAccepted: false });
    expect(noPrivacy.status).toBe(400);
    // reenvio do mesmo checkout (rede instável) não duplica
    const key = idemKey();
    const body = onlineOrder('11 94444-3333', { items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] });
    const [a, b] = await Promise.all([publicCheckout(body, key), publicCheckout(body, key)]);
    expect(a.body.number).toBe(b.body.number);
    expect((await caixa.get('/api/orders?status=pending')).body).toHaveLength(1);
    // token de rastreio inexistente
    expect((await new Client(h.app).get('/api/public/orders/AAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
  });

  it('nota não fiscal: chave Pix validada no servidor; CNPJ e impressão automática salvos', async () => {
    expect((await gerente.put('/api/settings', { pixKey: '11999998888' })).status).toBe(400); // celular sem +55
    const ok = await gerente.put('/api/settings', { pixKey: '+55 11 99999-8888', pixCity: 'São Paulo', storeDocument: 'CNPJ 11.222.333/0001-81', autoPrintReceipt: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ pixCity: 'São Paulo', storeDocument: 'CNPJ 11.222.333/0001-81', autoPrintReceipt: true });
    expect((await caixa.get('/api/settings')).body.pixKey).toBe('+55 11 99999-8888');
    expect((await gerente.put('/api/settings', { pixKey: '' })).status).toBe(200);
  });

  it('endereços da rede para o QR dos celulares: só caixa/gerente; lista http://ip:porta', async () => {
    const r = await caixa.get('/api/system/addresses');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.urls)).toBe(true);
    for (const u of r.body.urls as string[]) expect(u).toMatch(/^http:\/\/[\d.]+:\d+$|^http:\/\//);
    expect((await new Client(h.app).get('/api/system/addresses')).status).toBe(401);
  });

  it('logo da loja: envio só de imagem, rota pública, formulário antigo não apaga', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c00000000049454e44ae426082', 'hex');
    const send = (buf: Buffer, who = gerente) => {
      const boundary = '----guto' + Date.now();
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      return h.app.inject({ method: 'POST', url: '/api/settings/logo', payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-requested-with': 'guto', cookie: who.cookie } });
    };
    expect((await send(png, caixa)).statusCode).toBe(403);
    expect((await send(Buffer.from('<svg onload=alert(1)>'))).statusCode).toBe(400);
    const ok = await send(png);
    expect(ok.statusCode).toBe(200);
    const logoUrl = JSON.parse(ok.body).logoUrl as string;
    expect(logoUrl).toMatch(/^\/uploads\/logo-[\w-]+\.png$/);
    expect((await new Client(h.app).get('/api/public/brand')).body).toEqual({ name: expect.any(String), logoUrl, storeMode: false });
    expect((await h.app.inject({ method: 'GET', url: logoUrl })).statusCode).toBe(200);
    // salvar Ajustes com dados antigos (logoUrl vazio ou forjado) não muda a logo
    await gerente.put('/api/settings', { logoUrl: '' });
    expect((await gerente.put('/api/settings', { logoUrl: 'https://evil.example/x.png' })).status).toBe(400);
    expect((await gerente.get('/api/settings')).body.logoUrl).toBe(logoUrl);
    expect((await gerente.req('DELETE', '/api/settings/logo')).body.logoUrl).toBe('');
  });
});

describe('nº da entrega (sacola)', () => {
  it('cada entrega do dia ganha 1, 2, 3… (pedido online só ao aceitar); mesa e balcão não; aparece na cozinha e na expedição', async () => {
    const addr = { street: 'Rua A', number: '1', neighborhoodId: m.neighborhood('Centro') };
    const items = [{ variantId: m.variant('X-Burguer'), quantity: 1 }];
    const d1 = await caixa.post('/api/orders', { type: 'delivery', send: true, customer: { name: 'Ana', phone: '11 91111-1111' }, address: addr, items }, { 'idempotency-key': idemKey() });
    expect(d1.status).toBe(200);
    expect(d1.body.deliveryNumber).toBe(1);
    // balcão e mesa não usam nº de sacola, e não pulam a contagem
    const bal = await caixa.post('/api/orders', { type: 'takeout', send: true, customer: { name: 'Rafa', phone: null }, items }, { 'idempotency-key': idemKey() });
    expect(bal.body.deliveryNumber).toBeNull();
    await caixa.post('/api/orders', { type: 'table', tableLabel: '4', send: true, items }, { 'idempotency-key': idemKey() });
    // online: pendente sem número; ganha ao aceitar
    const on = await publicCheckout(onlineOrder('11 97777-1212'));
    expect(on.status).toBe(200);
    const pend = (await caixa.get('/api/orders?status=pending')).body[0];
    expect(pend.deliveryNumber).toBeNull();
    const d2 = await caixa.post('/api/orders', { type: 'delivery', send: true, customer: { name: 'Beto', phone: '11 92222-2222' }, address: addr, items }, { 'idempotency-key': idemKey() });
    expect(d2.body.deliveryNumber).toBe(2);
    await caixa.post(`/api/orders/${pend.id}/accept`, { version: pend.version });
    expect((await caixa.get(`/api/orders/${pend.id}`)).body.deliveryNumber).toBe(3);
    // cozinha e expedição mostram o número
    const tk = (await (await as(h, 'cozinha')).get('/api/kitchen')).body.tickets;
    expect(tk.find((t: any) => t.orderNumber === d2.body.number).deliveryNumber).toBe(2);
    expect(tk.find((t: any) => t.orderNumber === bal.body.number).deliveryNumber).toBeNull();
    const board = (await caixa.get('/api/deliveries')).body.orders;
    expect(board.map((o: any) => o.deliveryNumber).sort()).toEqual([1, 2, 3]);
  });

  it('via da cozinha leva o endereço para o motoboy; 2ª via de pedido já pronto vai para o computador da cozinha', async () => {
    const addr = { street: 'Av. Brasil', number: '450', complement: 'apto 2', reference: 'perto da padaria', neighborhoodId: m.neighborhood('Centro') };
    const d = await caixa.post('/api/orders', { type: 'delivery', send: true, customer: { name: 'Carla', phone: '11 98877-1020' }, address: addr, items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }], paymentIntent: 'cash', changeForCents: 5000 }, { 'idempotency-key': idemKey() });
    const k = await as(h, 'cozinha');
    const t = (await k.get('/api/kitchen')).body.tickets.find((x: any) => x.orderNumber === d.body.number);
    expect(t.delivery).toMatchObject({ address: 'Av. Brasil, 450 - apto 2', neighborhood: 'Centro', reference: 'perto da padaria', phone: '(11) 98877-1020' });
    expect(t.delivery.collect).toMatch(/^COBRAR R\$ .* — dinheiro · troco p\/ R\$ 50,00/);
    // fica pronto e sai da fila; a 2ª via ainda funciona
    await k.post(`/api/kitchen/tickets/${t.id}/status`, { status: 'ready' });
    const events: any[] = [];
    const on = (e: any) => e.type === 'kitchen.reprint' && events.push(e);
    h.deps.bus.on('event', on);
    const r = await caixa.post('/api/kitchen/reprint', { orderId: d.body.id });
    h.deps.bus.off('event', on);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ via: 'computador', count: 1, orderNumber: d.body.number });
    expect(events[0].ticketIds).toEqual([t.id]);
    const got = (await k.get(`/api/kitchen/tickets?ids=${t.id}`)).body.tickets;
    expect(got[0].delivery.address).toBe('Av. Brasil, 450 - apto 2');
    // entregador não pede 2ª via; pedido sem cozinha avisa
    expect((await (await as(h, 'moto1')).post('/api/kitchen/reprint', { orderId: d.body.id })).status).toBe(403);
    expect((await caixa.post('/api/kitchen/reprint', {})).status).toBe(400);
  });
});

describe('cardápio na internet: porteiro', () => {
  it('de fora só passa o cardápio; API interna bloqueada; cookie da equipe não passa', async () => {
    const { startPublicGateway } = await import('../../src/services/publicGateway.js');
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const appPort = (h.app.server.address() as { port: number }).port;
    const gw = startPublicGateway(0, appPort, { warn: () => undefined });
    await new Promise((r) => gw.once('listening', r));
    const base = `http://127.0.0.1:${(gw.address() as { port: number }).port}`;
    try {
      expect((await fetch(`${base}/api/public/menu`)).status).toBe(200);
      expect((await fetch(`${base}/api/orders`, { headers: { cookie: caixa.cookie } })).status).toBe(404);
      expect((await fetch(`${base}/api/settings`, { headers: { cookie: gerente.cookie } })).status).toBe(404);
      const home = await fetch(`${base}/`, { redirect: 'manual' });
      expect(home.status).toBe(302);
      expect(home.headers.get('location')).toBe('/c');
      // rota liberada não leva a sessão: a API pública responde sem saber quem é a equipe
      const brand = await fetch(`${base}/api/public/brand`, { headers: { cookie: gerente.cookie } });
      expect(brand.status).toBe(200);
      expect(brand.headers.get('set-cookie')).toBeNull();
    } finally {
      gw.close();
    }
  });
});
