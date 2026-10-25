import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, menuIndex, resetDb, setClock, startApp, type Client } from '../helpers.js';

let h: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  h = await startApp();
});
afterAll(async () => {
  setClock(null);
  await h.close();
});
beforeEach(async () => {
  await resetDb(h);
});

/** Horário local de São Paulo (UTC-3, sem horário de verão). */
function sp(iso: string) {
  return new Date(iso + '-03:00');
}

async function quickOrder(c: Client, variantId: string) {
  const r = await c.post('/api/orders', { type: 'counter', items: [{ variantId, quantity: 1 }], confirmDuplicate: true });
  expect(r.status).toBe(200);
  return r.body;
}

async function finish(c: Client, k: Client, o: any) {
  for (const t of o.tickets) await k.post(`/api/kitchen/tickets/${t.id}/status`, { status: 'ready' });
  await c.post(`/api/orders/${o.id}/payments`, { method: 'pix_manual', amountCents: o.totalCents });
  const cur = (await c.get(`/api/orders/${o.id}`)).body;
  const r = await c.post(`/api/orders/${o.id}/close`, { version: cur.version });
  expect(r.status).toBe(200);
}

describe('5. dia operacional atravessando a meia-noite', () => {
  it('mantém pedidos após 00h no turno aberto e separa os dias', async () => {
    let clock = sp('2026-10-24T19:00:00');
    setClock(() => clock);
    const caixa = await as(h, 'caixa');
    const g = await as(h, 'gerente');
    const k = await as(h, 'cozinha');
    const m = await menuIndex(caixa);

    // sem dia aberto não há pedidos
    const closed = await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('day_closed');

    const day1 = (await caixa.post('/api/day/open', {})).body; // caixa pode abrir o dia
    expect(day1.referenceDate).toBe('2026-10-24');
    await g.post('/api/cash/open', { openingCents: 5000 });

    clock = sp('2026-10-24T23:30:00');
    const a = await quickOrder(caixa, m.variant('X-Burguer'));
    clock = sp('2026-10-25T00:30:00'); // virou o dia no calendário
    const b = await quickOrder(caixa, m.variant('X-Bacon'));
    clock = sp('2026-10-25T02:10:00');
    const c = await quickOrder(caixa, m.variant('X-Tudo'));
    expect([a.number, b.number, c.number]).toEqual([1, 2, 3]);
    expect(new Set([a.businessDayId, b.businessDayId, c.businessDayId])).toEqual(new Set([day1.id]));

    // não fecha com pedidos em aberto
    const blocked = await g.post('/api/day/close', {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('day_has_open_orders');
    expect(blocked.body.error.details.orders).toHaveLength(3);
    // caixa não fecha o dia
    expect((await caixa.post('/api/day/close', {})).status).toBe(403);

    for (const o of [a, b, c]) await finish(caixa, k, o);
    const cashOpen = await g.post('/api/day/close', {});
    expect(cashOpen.body.error.code).toBe('cash_open');
    clock = sp('2026-10-25T03:00:00');
    const closeCash = await g.post('/api/cash/close', { countedCashCents: 5000 });
    expect(closeCash.status).toBe(200);
    const done = await g.post('/api/day/close', {});
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('closed');

    // novo dia: numeração recomeça
    clock = sp('2026-10-25T18:00:00');
    const day2 = (await g.post('/api/day/open', {})).body;
    expect(day2.referenceDate).toBe('2026-10-25');
    await g.post('/api/cash/open', { openingCents: 5000 });
    const d = await quickOrder(caixa, m.variant('X-Burguer'));
    expect(d.number).toBe(1);
    expect(d.businessDayId).toBe(day2.id);

    // relatórios por dia operacional
    const r1 = (await g.get('/api/reports/sales?from=2026-10-24&to=2026-10-24')).body;
    expect(r1.summary.orders).toBe(3);
    expect(r1.summary.netCents).toBe(1350 + 1890 + 2190);
    expect(r1.byHour.map((x: any) => x.hour)).toEqual([0, 2, 23]);
    const r2 = (await g.get('/api/reports/sales?from=2026-10-25&to=2026-10-25')).body;
    expect(r2.summary.orders).toBe(1); // pedidos em aberto entram como venda do dia em andamento
    expect(r2.summary.netCents).toBe(1350);
  });
});
