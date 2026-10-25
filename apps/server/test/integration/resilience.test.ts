import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { as, idemKey, menuIndex, openStore, resetDb, startApp, TEST_DB, type Client } from '../helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let h: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  h = await startApp();
  await resetDb(h);
});
afterAll(async () => {
  await h.close();
});

describe('13. uso simultâneo em dois dispositivos', () => {
  it('edição concorrente não sobrescreve, números não se repetem, cobrança não duplica', async () => {
    await openStore(h);
    const pdv1 = await as(h, 'caixa');
    const pdv2 = await as(h, 'gerente');
    const m = await menuIndex(pdv1);
    const o = (await pdv1.post('/api/orders', { type: 'table', tableLabel: '7', items: [{ variantId: m.variant('X-Burguer'), quantity: 1 }] })).body;
    // os dois dispositivos abrem a mesma comanda
    const seen1 = (await pdv1.get(`/api/orders/${o.id}`)).body;
    const seen2 = (await pdv2.get(`/api/orders/${o.id}`)).body;
    const a = await pdv1.post(`/api/orders/${o.id}/items`, { version: seen1.version, items: [{ variantId: m.variant('Batata frita'), quantity: 1 }] });
    expect(a.status).toBe(200);
    const b = await pdv2.patch(`/api/orders/${o.id}`, { version: seen2.version, notes: 'mesa da janela' });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('stale_version');
    const reload = (await pdv2.get(`/api/orders/${o.id}`)).body;
    expect((await pdv2.patch(`/api/orders/${o.id}`, { version: reload.version, notes: 'mesa da janela' })).status).toBe(200);
    const final = (await pdv1.get(`/api/orders/${o.id}`)).body;
    expect(final.notes).toBe('mesa da janela');
    expect(final.items.filter((i: any) => i.status === 'active')).toHaveLength(2); // nada perdido

    // edições simultâneas da mesma versão: exatamente uma vence
    const v = final.version;
    const race = await Promise.all([
      pdv1.patch(`/api/orders/${o.id}`, { version: v, notes: 'A' }),
      pdv2.patch(`/api/orders/${o.id}`, { version: v, notes: 'B' }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);

    // 20 pedidos simultâneos em dois caixas: numeração única e sequencial
    const many = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? pdv1 : pdv2).post('/api/orders', { type: 'counter', items: [{ variantId: m.variant('Refrigerante lata'), quantity: 1 }], confirmDuplicate: true }, { 'idempotency-key': idemKey() }),
      ),
    );
    expect(many.every((r) => r.status === 200)).toBe(true);
    const nums = many.map((r) => r.body.number).sort((x, y) => x - y);
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 2));

    // dois dispositivos cobrando o saldo inteiro ao mesmo tempo: só um passa
    const target = many[0]!.body;
    const pays = await Promise.all([
      pdv1.post(`/api/orders/${target.id}/payments`, { method: 'cash', amountCents: 600 }, { 'idempotency-key': idemKey() }),
      pdv2.post(`/api/orders/${target.id}/payments`, { method: 'pix_manual', amountCents: 600 }, { 'idempotency-key': idemKey() }),
    ]);
    expect(pays.map((p) => p.status).sort()).toEqual([200, 409]);
    expect((await pdv1.get(`/api/orders/${target.id}`)).body.paidCents).toBe(600);
  });

  it('atualização em tempo real chega ao outro dispositivo (SSE)', async () => {
    const address = await h.app.listen({ port: 0, host: '127.0.0.1' });
    const k = await as(h, 'cozinha');
    const caixa = await as(h, 'caixa');
    const m = await menuIndex(caixa);
    const ctrl = new AbortController();
    const res = await fetch(`${address}/api/events`, { headers: { cookie: k.cookie }, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const received: string[] = [];
    const reading = (async () => {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received.push(dec.decode(value));
        if (received.join('').includes('kitchen.changed')) break;
      }
    })();
    const o = await caixa.post('/api/orders', { type: 'counter', items: [{ variantId: m.variant('X-Tudo'), quantity: 1 }], confirmDuplicate: true });
    await Promise.race([reading, new Promise((r) => setTimeout(r, 3000))]);
    ctrl.abort();
    const all = received.join('');
    expect(all).toContain('kitchen.changed');
    expect(all).toContain(o.body.id);
    // perfil cozinha não recebe eventos de caixa/WhatsApp
    expect(all).not.toContain('cash.changed');
  });
});

describe('14. persistência após reiniciar a aplicação', () => {
  it('dados e sessões sobrevivem a um novo processo do servidor', async () => {
    const caixa = await as(h, 'caixa');
    const m = await menuIndex(caixa);
    const o = (await caixa.post('/api/orders', { type: 'counter', notes: 'persistir', items: [{ variantId: m.variant('X-Picanha'), quantity: 1 }], confirmDuplicate: true })).body;
    const cookie = caixa.cookie;
    await h.close();
    h = await startApp(); // nova instância, novo pool de conexões
    const again = new (caixa.constructor as new (app: unknown) => Client)(h.app);
    again.cookie = cookie;
    const r = await again.get(`/api/orders/${o.id}`);
    expect(r.status).toBe(200);
    expect(r.body.notes).toBe('persistir');
    expect(r.body.totalCents).toBe(2590);
  });
});

describe('15. backup e restauração', () => {
  it('gera backup válido e restaura em outro banco com os mesmos dados', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guto-backup-'));
    const env = { ...process.env, DATABASE_URL: TEST_DB, BACKUP_KEEP: '2' };
    const out = execFileSync('bash', [path.join(root, 'scripts/backup.sh'), dir], { env, encoding: 'utf8' });
    expect(out).toMatch(/Backup gravado/);
    const file = fs.readdirSync(dir).find((f) => f.endsWith('.dump'))!;
    expect(fs.existsSync(path.join(dir, file + '.sha256'))).toBe(true);

    const restoreUrl = TEST_DB.replace(/\/[^/]+$/, '/guto_restore_test');
    const admin = new pg.Client({ connectionString: TEST_DB });
    await admin.connect();
    await admin.query('drop database if exists guto_restore_test');
    await admin.query('create database guto_restore_test');
    await admin.end();

    // sem confirmação explícita não restaura
    expect(() => execFileSync('bash', [path.join(root, 'scripts/restore.sh'), path.join(dir, file)], { env: { ...env, DATABASE_URL: restoreUrl }, stdio: 'pipe' })).toThrow();
    const r = execFileSync('bash', [path.join(root, 'scripts/restore.sh'), path.join(dir, file), '--confirmar'], { env: { ...env, DATABASE_URL: restoreUrl }, encoding: 'utf8' });
    expect(r).toMatch(/Restauração concluída/);
    expect(r).not.toMatch(/guto:guto@/); // não imprime senha

    const q = `select (select count(*) from orders)::int o, (select count(*) from order_items)::int i, (select count(*) from payments)::int p,
      (select coalesce(sum(total_cents),0) from orders)::int t, (select count(*) from users)::int u, (select count(*) from stock_movements)::int s`;
    const src = new pg.Client({ connectionString: TEST_DB });
    const dst = new pg.Client({ connectionString: restoreUrl });
    await src.connect();
    await dst.connect();
    const a = (await src.query(q)).rows[0];
    const b = (await dst.query(q)).rows[0];
    expect(a.o).toBeGreaterThan(0);
    expect(b).toEqual(a);
    await src.end();
    await dst.end();

    // a aplicação funciona sobre o banco restaurado
    const restored = await startApp({ DATABASE_URL: restoreUrl } as never);
    const c = await as(restored, 'caixa');
    const list = (await c.get('/api/orders?limit=500')).body;
    expect(list.length).toBe(a.o);
    await restored.close();
  });
});
