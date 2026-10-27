import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, idemKey, menuIndex, openStore, resetDb, setClock, startApp, type Client, type MenuIndex } from '../helpers.js';

let h: Awaited<ReturnType<typeof startApp>>;
let ana: Client;
let beto: Client;
let caixa: Client;
let cozinha: Client;
let m: MenuIndex;
const events: any[] = [];

beforeAll(async () => {
  h = await startApp();
  h.deps.bus.on('event', (e) => events.push(e));
});
afterAll(async () => {
  setClock(null);
  await h.close();
});
beforeEach(async () => {
  await resetDb(h);
  events.length = 0;
  await openStore(h);
  ana = await as(h, 'atendente1');
  beto = await as(h, 'atendente2');
  caixa = await as(h, 'caixa');
  cozinha = await as(h, 'cozinha');
  m = await menuIndex(ana);
});

const xbacon = () => ({
  variantId: m.variant('X-Bacon'),
  quantity: 2,
  options: [
    { optionId: m.option('Cheddar'), quantity: 1 },
    { optionId: m.option('Sem cebola'), quantity: 1 },
  ],
  notes: 'bem passado',
});

describe('app do atendente', () => {
  it('abre mesa e comanda, identifica o atendente e manda só os novos itens como nova rodada', async () => {
    const mesa = await ana.post('/api/orders', { type: 'table', tabKind: 'table', tableLabel: '12', items: [xbacon(), { variantId: m.variant('Refrigerante lata'), quantity: 2 }] }, { 'idempotency-key': idemKey() });
    expect(mesa.status).toBe(200);
    expect(mesa.body.place).toBe('Mesa 12');
    expect(mesa.body.createdByName).toBe('Atendente Ana (demo)');
    expect(mesa.body.tickets).toHaveLength(1);
    expect(mesa.body.tickets[0].createdByName).toBe('Atendente Ana (demo)');
    // comanda 12 não conflita com a mesa 12
    const comanda = await beto.post('/api/orders', { type: 'table', tabKind: 'tab', tableLabel: '12', items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] });
    expect(comanda.status).toBe(200);
    expect(comanda.body.place).toBe('Comanda 12');

    // cozinha mostra mesa, atendente e observações
    const k1 = (await cozinha.get('/api/kitchen')).body.tickets;
    const t1 = k1.find((t: any) => t.orderId === mesa.body.id);
    expect(t1).toMatchObject({ place: 'Mesa 12', createdByName: 'Atendente Ana (demo)', round: 1 });
    expect(t1.items.map((i: any) => i.productName)).toEqual(['X-Bacon']); // bebida não vai para a cozinha
    expect(t1.items[0].notes).toBe('bem passado');
    await cozinha.post(`/api/kitchen/tickets/${t1.id}/status`, { status: 'preparing' });

    // o caixa mexeu no pedido (versão mudou); o acréscimo do atendente não depende da versão
    const v = (await caixa.get(`/api/orders/${mesa.body.id}`)).body.version;
    await caixa.patch(`/api/orders/${mesa.body.id}`, { version: v, notes: 'cliente da janela' });
    const add = await ana.post(`/api/orders/${mesa.body.id}/items`, { items: [{ variantId: m.variant('Batata frita'), quantity: 1, notes: 'bem crocante' }] }, { 'idempotency-key': idemKey() });
    expect(add.status).toBe(200);
    expect(add.body.notes).toBe('cliente da janela'); // nada apagado
    expect(add.body.tickets).toHaveLength(2);
    const k2 = (await cozinha.get('/api/kitchen')).body.tickets.filter((t: any) => t.orderId === mesa.body.id);
    const r1 = k2.find((t: any) => t.round === 1);
    const r2 = k2.find((t: any) => t.round === 2);
    expect(r1.status).toBe('preparing'); // histórico mantido, não volta a "novo"
    expect(r1.items.map((i: any) => i.productName)).toEqual(['X-Bacon']);
    expect(r2.status).toBe('received');
    expect(r2.items.map((i: any) => i.productName)).toEqual(['Batata frita']); // só o novo item
    expect(add.body.totalCents).toBe(2 * (1890 + 400) + 2 * 600 + 2290);
  });

  it('dois atendentes abrindo a mesma mesa ao mesmo tempo: uma comanda só', async () => {
    const body = { type: 'table', tabKind: 'table', tableLabel: '7', items: [{ variantId: m.variant('X-Tudo'), quantity: 1 }] };
    const [a, b] = await Promise.all([ana.post('/api/orders', body, { 'idempotency-key': idemKey() }), beto.post('/api/orders', body, { 'idempotency-key': idemKey() })]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    const winner = a.status === 200 ? a : b;
    expect(loser.body.error.code).toBe('table_busy');
    expect(loser.body.error.details.id).toBe(winner.body.id); // o app oferece acrescentar na comanda existente
    expect((await caixa.get('/api/orders?status=open')).body).toHaveLength(1);
  });

  it('toque repetido e reenvio após queda de conexão não duplicam a rodada', async () => {
    const o = (await ana.post('/api/orders', { type: 'table', tableLabel: '3', items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] })).body;
    const key = idemKey();
    const items = { items: [{ variantId: m.variant('X-Egg Bacon'), quantity: 1 }] };
    const burst = await Promise.all([1, 2, 3, 4].map(() => ana.post(`/api/orders/${o.id}/items`, items, { 'idempotency-key': key })));
    expect(burst.every((r) => r.status === 200)).toBe(true);
    expect(new Set(burst.map((r) => r.body.sentTicketId)).size).toBe(1);
    // o servidor processou, mas a resposta "se perdeu"; o app reenvia a mesma chave mais tarde
    await caixa.patch(`/api/orders/${o.id}`, { version: burst[0]!.body.version, notes: 'x' });
    const retry = await ana.post(`/api/orders/${o.id}/items`, items, { 'idempotency-key': key });
    expect(retry.status).toBe(200);
    const fresh = (await caixa.get(`/api/orders/${o.id}`)).body;
    expect(fresh.tickets).toHaveLength(2);
    expect(fresh.items.filter((i: any) => i.productName === 'X-Egg Bacon')).toHaveLength(1);
  });

  it('permissões do atendente', async () => {
    const o = (await ana.post('/api/orders', { type: 'table', tableLabel: '9', items: [xbacon()] })).body;
    expect((await ana.post(`/api/orders/${o.id}/payments`, { method: 'cash', amountCents: 100 })).status).toBe(403);
    expect((await ana.post(`/api/orders/${o.id}/close`, { version: o.version })).status).toBe(403);
    const disc = await ana.put(`/api/orders/${o.id}/discount`, { version: o.version, discount: { type: 'percent', value: 500, reason: 'amigo' } });
    expect(disc.body.error.code).toBe('supervisor_required');
    const cancel = await ana.post(`/api/orders/${o.id}/cancel`, { version: o.version, reason: 'desistiu' });
    expect(cancel.body.error.code).toBe('supervisor_required');
    const cancelItem = await ana.post(`/api/orders/${o.id}/items/${o.items[0].id}/cancel`, { version: o.version, reason: 'errei' });
    expect(cancelItem.body.error.code).toBe('supervisor_required');
    for (const url of ['/api/cash', '/api/reports/sales?from=2026-01-01&to=2026-12-31', '/api/kitchen', '/api/deliveries', '/api/users']) {
      expect((await ana.get(url)).status, url).toBe(403);
    }
    // com autorização do gerente o cancelamento do item enviado é registrado e destacado para a cozinha
    const ok = await ana.post(`/api/orders/${o.id}/items/${o.items[0].id}/cancel`, { version: o.version, reason: 'errei a mesa', supervisor: { username: 'gerente', password: 'demo1234' } });
    expect(ok.status).toBe(200);
    const t = (await cozinha.get('/api/kitchen')).body.tickets.find((x: any) => x.orderId === o.id);
    expect(t.changeNote).toMatch(/CANCELADO: 2x X-Bacon/);
    expect(ok.body.events.find((e: any) => e.type === 'item.cancelled')).toMatchObject({ userName: 'Atendente Ana (demo)', authorizedByName: 'Gerente Demo' });
  });

  it('pronto → entregue à mesa → pedir conta → caixa recebe e fecha', async () => {
    const o = (await ana.post('/api/orders', { type: 'table', tableLabel: '5', items: [xbacon(), { variantId: m.variant('Refrigerante lata'), quantity: 1 }] })).body;
    const tk = o.tickets[0].id;
    expect((await ana.post(`/api/kitchen/tickets/${tk}/served`, {})).status).toBe(409); // ainda não pronto
    await cozinha.post(`/api/kitchen/tickets/${tk}/status`, { status: 'ready' });
    let cur = (await ana.get(`/api/orders/${o.id}`)).body;
    expect(cur.stage).toBe('ready');
    expect((await ana.post(`/api/kitchen/tickets/${tk}/served`, {})).status).toBe(200);
    cur = (await ana.get(`/api/orders/${o.id}`)).body;
    expect(cur.stage).toBe('delivered');
    expect(cur.tickets[0].servedByName).toBe('Atendente Ana (demo)');
    expect((await cozinha.get('/api/kitchen')).body.tickets.find((x: any) => x.id === tk)).toBeUndefined();

    events.length = 0;
    expect((await ana.post(`/api/orders/${o.id}/request-bill`, {})).status).toBe(200);
    expect((await ana.post(`/api/orders/${o.id}/request-bill`, {})).status).toBe(200); // repetido
    await new Promise((r) => setTimeout(r, 20));
    const bills = events.filter((e) => e.type === 'bill.requested');
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ place: 'Mesa 5', by: 'Atendente Ana (demo)' });
    const rows = (await caixa.get('/api/orders?type=table&status=open')).body;
    expect(rows[0]).toMatchObject({ billRequestedAt: expect.any(String), createdByName: 'Atendente Ana (demo)', tabKind: 'table' });
    expect(rows[0].rounds).toMatchObject({ received: 0, preparing: 0, ready: 0, served: 1 });

    cur = (await caixa.get(`/api/orders/${o.id}`)).body;
    const pay = await caixa.post(`/api/orders/${o.id}/payments`, { method: 'debit', amountCents: cur.balanceCents }, { 'idempotency-key': idemKey() });
    expect(pay.status).toBe(200);
    const closed = await caixa.post(`/api/orders/${o.id}/close`, { version: pay.body.order.version });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed');
    // a mesa fica livre para uma nova comanda
    expect((await ana.post('/api/orders', { type: 'table', tableLabel: '5', items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] })).status).toBe(200);
  });

  it('presença: aparelho que para de dar sinal aparece desconectado', async () => {
    let clock = new Date();
    setClock(() => clock);
    expect((await ana.post('/api/presence', { device: 'celular-ana-001', label: 'Celular da Ana' })).status).toBe(200);
    expect((await cozinha.post('/api/presence', { device: 'tablet-cozinha-01', label: 'Tablet cozinha' })).status).toBe(200);
    let list = (await caixa.get('/api/presence')).body;
    expect(list.filter((d: any) => d.online).map((d: any) => d.label).sort()).toEqual(['Celular da Ana', 'Tablet cozinha']);
    events.length = 0;
    clock = new Date(clock.getTime() + 30_000);
    await cozinha.post('/api/presence', { device: 'tablet-cozinha-01', label: 'Tablet cozinha' });
    clock = new Date(clock.getTime() + 30_000);
    h.presence.sweep();
    list = (await caixa.get('/api/presence')).body;
    expect(list.find((d: any) => d.label === 'Celular da Ana').online).toBe(false);
    expect(list.find((d: any) => d.label === 'Tablet cozinha').online).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(events.some((e) => e.type === 'presence.changed')).toBe(true);
    expect((await (await as(h, 'moto1')).get('/api/presence')).status).toBe(403);
    setClock(null);
  });
});
