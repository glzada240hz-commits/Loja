import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { Client, as, menuIndex, openStore, resetDb, startApp, testConfig } from '../helpers.js';

let h: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  h = await startApp();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetDb(h);
});

describe('12. acesso proibido entre perfis (verificado no servidor)', () => {
  it('matriz de permissões', async () => {
    await openStore(h);
    const users = {
      anon: new Client(h.app),
      cozinha: await as(h, 'cozinha'),
      moto1: await as(h, 'moto1'),
      caixa: await as(h, 'caixa'),
      gerente: await as(h, 'gerente'),
      admin: await as(h, 'admin'),
    };
    const courierId = (await users.gerente.get('/api/couriers')).body[0].id;
    const customerId = '00000000-0000-4000-8000-000000000000';
    const R = '?from=2026-01-01&to=2026-12-31';
    // [método, url, corpo, status esperado por perfil]
    const matrix: [string, string, unknown, Record<keyof typeof users, number[]>][] = [
      ['GET', '/api/orders', undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [200], gerente: [200], admin: [200] }],
      ['GET', '/api/menu', undefined, { anon: [401], cozinha: [200], moto1: [403], caixa: [200], gerente: [200], admin: [200] }],
      ['GET', '/api/kitchen', undefined, { anon: [401], cozinha: [200], moto1: [403], caixa: [200], gerente: [200], admin: [200] }],
      ['GET', '/api/courier/me', undefined, { anon: [401], cozinha: [403], moto1: [200], caixa: [403], gerente: [403], admin: [403] }],
      ['GET', '/api/deliveries', undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [200], gerente: [200], admin: [200] }],
      ['GET', '/api/cash', undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [200], gerente: [200], admin: [200] }],
      ['GET', '/api/reports/sales' + R, undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [200], admin: [200] }],
      ['GET', '/api/reports/export' + R + '&kind=orders', undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [200], admin: [200] }],
      ['GET', '/api/users', undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [403], admin: [200] }],
      ['POST', '/api/users', { name: 'X', username: 'novo', role: 'admin', password: '12345678' }, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [403], admin: [200] }],
      ['GET', '/api/audit', undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [200], admin: [200] }],
      ['GET', '/api/customers?q=ma', undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [200], gerente: [200], admin: [200] }],
      ['POST', `/api/customers/${customerId}/anonymize`, { reason: 'pedido do titular' }, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [403], admin: [404] }],
      ['GET', '/api/whatsapp/conversations', undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [200], gerente: [200], admin: [200] }],
      ['POST', '/api/menu/availability', { target: 'product', id: customerId, available: false }, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [404], admin: [404] }],
      ['POST', '/api/stock/movements', { stockItemId: customerId, type: 'loss', quantity: '1', reason: 'x' }, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [404], admin: [404] }],
      ['POST', `/api/couriers/${courierId}/settle`, { paidFromCash: false, expectedTotalCents: 0 }, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [409], admin: [409] }],
      ['POST', '/api/day/close', {}, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [409], admin: [409] }],
      ['POST', '/api/cash/close', { countedCashCents: 0 }, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [422], admin: [422] }],
      ['PUT', '/api/settings', { kitchenLateMinutes: 25 }, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [200], admin: [200] }],
      ['GET', '/api/expenses' + R, undefined, { anon: [401], cozinha: [403], moto1: [403], caixa: [403], gerente: [200], admin: [200] }],
    ];
    const failures: string[] = [];
    for (const [method, url, body, expected] of matrix) {
      for (const [who, client] of Object.entries(users)) {
        const r = await client.req(method, url, body);
        const ok = expected[who as keyof typeof users];
        if (!ok.includes(r.status)) failures.push(`${who} ${method} ${url} => ${r.status} (esperado ${ok.join('/')})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('CSRF, cookie de sessão, logout, bloqueio e desativação', async () => {
    const c = new Client(h.app);
    const login = await c.post('/api/auth/login', { username: 'caixa', password: 'demo1234' });
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // sem o cabeçalho anti-CSRF uma requisição de outro site é recusada
    const csrf = await c.req('POST', '/api/day/open', {}, { 'x-requested-with': '' });
    expect(csrf.status).toBe(403);
    expect(csrf.body.error.code).toBe('csrf');
    // senha errada repetida bloqueia temporariamente, mesmo acertando depois
    const attacker = new Client(h.app);
    for (let i = 0; i < 5; i++) expect((await attacker.post('/api/auth/login', { username: 'gerente', password: 'errada' })).status).toBe(401);
    expect((await attacker.post('/api/auth/login', { username: 'gerente', password: 'demo1234' })).status).toBe(429);
    // usuário inexistente: mesma mensagem genérica
    const nouser = await attacker.post('/api/auth/login', { username: 'naoexiste', password: 'x' });
    expect(nouser.body.error.message).toBe('Usuário ou senha incorretos');
    // logout invalida a sessão
    const cookie = c.cookie;
    await c.post('/api/auth/logout', {});
    const reuse = new Client(h.app);
    reuse.cookie = cookie;
    expect((await reuse.get('/api/auth/me')).status).toBe(401);
    // desativar usuário derruba sessões ativas
    const caixa = await as(h, 'caixa');
    const admin = await as(h, 'admin');
    const list = (await admin.get('/api/users')).body;
    const u = list.find((x: any) => x.username === 'caixa');
    expect((await admin.post('/api/users', { id: u.id, name: u.name, username: u.username, role: u.role, active: false })).status).toBe(200);
    expect((await caixa.get('/api/orders')).status).toBe(401);
    // não é possível remover o último administrador
    const me = list.find((x: any) => x.username === 'admin');
    expect((await admin.post('/api/users', { id: me.id, name: me.name, username: me.username, role: 'manager' })).status).toBe(409);
  });

  it('limite de tentativas de login por IP', async () => {
    const h2 = await buildApp(testConfig({ LOGIN_RATE_LIMIT: '10' }), { logger: false });
    const c = new Client(h2.app);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await c.post('/api/auth/login', { username: 'x' + i, password: 'y' })).status);
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    await h2.close();
  });

  it('exportação CSV neutraliza fórmulas e dados de entrada são validados', async () => {
    const g = await openStore(h);
    const caixa = await as(h, 'caixa');
    const m = await menuIndex(caixa);
    const r = await caixa.post('/api/orders', { type: 'counter', customer: { name: '=HYPERLINK("http://mal")', phone: '11 98888-1111' }, items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] });
    expect(r.status).toBe(200);
    const csv = await g.get('/api/reports/export?kind=orders&from=2000-01-01&to=2100-01-01');
    expect(csv.status).toBe(200);
    expect(String(csv.headers['content-type'])).toMatch(/text\/csv/);
    expect(csv.body).toContain(`"'=HYPERLINK(""http://mal"")"`);
    // validação de entrada
    expect((await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: 'nao-e-uuid', quantity: 1 }] })).status).toBe(400);
    expect((await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: m.variant('X-Burguer'), quantity: 1000 }] })).status).toBe(400);
    expect((await caixa.post('/api/orders', { type: 'counter', items: [] })).status).toBe(400);
    expect((await caixa.post('/api/orders', { type: 'hack', items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] })).status).toBe(400);
    const badJson = await h.app.inject({ method: 'POST', url: '/api/orders', payload: '{oops', headers: { 'content-type': 'application/json', 'x-requested-with': 'guto', cookie: caixa.cookie } });
    expect(badJson.statusCode).toBe(400);
  });

  it('webhook oficial desativado no modo demonstrativo; simulação só no demo', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/api/webhooks/whatsapp', payload: '{}', headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(503);
    const status = (await (await as(h, 'caixa')).get('/api/whatsapp/status')).body;
    expect(status.mode).toBe('demo');
  });
});
