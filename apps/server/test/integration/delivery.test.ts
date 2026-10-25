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
    const sent1 = h.demo.sent.at(-1)!;
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
});
