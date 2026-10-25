import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppHandle } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed, truncateAll } from '../src/db/seed.js';
import { setClock } from '../src/lib/clock.js';
import { DemoProvider } from '../src/whatsapp/provider.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://guto:guto@localhost:5432/guto_test';
export const ADMIN_PW = 'admin-test-123';
export const DEMO_PW = 'demo1234';

export function testConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    DISABLE_WORKERS: 'true',
    UPLOAD_DIR: path.join(os.tmpdir(), 'guto-test-uploads'),
    WEB_DIST: '/nonexistent',
    PUBLIC_BASE_URL: 'http://loja.test',
    LOGIN_RATE_LIMIT: '100000',
    CHECKOUT_RATE_LIMIT: '100000',
    ...extra,
  });
}

export async function startApp(extra: Record<string, string> = {}): Promise<AppHandle & { demo: DemoProvider }> {
  const demo = new DemoProvider();
  const h = await buildApp(testConfig(extra), { wa: extra.WHATSAPP_MODE === 'cloud' ? undefined : demo, logger: false });
  await runMigrations(h.db);
  return Object.assign(h, { demo });
}

export async function resetDb(h: AppHandle) {
  setClock(null);
  await truncateAll(h.db);
  await seed(h.db, { adminPassword: ADMIN_PW, demoUsers: true, demoData: true });
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

/** Cliente HTTP com cookie de sessão (simula um dispositivo). */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}

  async req<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
    const r = await this.app.inject({
      method: method as never,
      url,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        'x-requested-with': 'guto',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
    });
    const sc = r.headers['set-cookie'];
    const cookies = Array.isArray(sc) ? sc : sc ? [sc] : [];
    for (const c of cookies) {
      const [kv] = c.split(';');
      if (kv!.startsWith('guto_session=')) this.cookie = kv!.endsWith('=') ? '' : kv!;
    }
    let parsed: unknown = r.body;
    try {
      parsed = JSON.parse(r.body);
    } catch {
      /* texto */
    }
    return { status: r.statusCode, body: parsed as T, headers: r.headers };
  }
  get<T = any>(url: string) {
    return this.req<T>('GET', url);
  }
  post<T = any>(url: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.req<T>('POST', url, body, headers);
  }
  patch<T = any>(url: string, body: unknown) {
    return this.req<T>('PATCH', url, body);
  }
  put<T = any>(url: string, body: unknown) {
    return this.req<T>('PUT', url, body);
  }
  async login(username: string, password = username === 'admin' ? ADMIN_PW : DEMO_PW) {
    const r = await this.post('/api/auth/login', { username, password });
    if (r.status !== 200) throw new Error(`login ${username} falhou: ${JSON.stringify(r.body)}`);
    return this;
  }
}

export async function as(h: AppHandle, username: string) {
  return new Client(h.app).login(username);
}

export interface MenuIndex {
  variant(name: string): string;
  option(name: string): string;
  neighborhood(name: string): string;
}

export async function menuIndex(c: Client): Promise<MenuIndex> {
  const menu = (await c.get('/api/menu')).body as any[];
  const nbs = (await c.get('/api/neighborhoods')).body as any[];
  const variants = new Map<string, string>();
  const options = new Map<string, string>();
  for (const cat of menu)
    for (const p of cat.products) {
      for (const v of p.variants) variants.set(v.name === 'Único' ? p.name : `${p.name} ${v.name}`, v.id);
      for (const g of p.groups) for (const o of g.options) options.set(o.name, o.id);
    }
  return {
    variant: (n) => variants.get(n) ?? fail('variante ' + n),
    option: (n) => options.get(n) ?? fail('adicional ' + n),
    neighborhood: (n) => nbs.find((x) => x.name === n)?.id ?? fail('bairro ' + n),
  };
}

function fail(what: string): never {
  throw new Error('não encontrado: ' + what);
}

/** Abre dia e caixa com o gerente. */
export async function openStore(h: AppHandle, openingCents = 10000) {
  const g = await as(h, 'gerente');
  const d = await g.post('/api/day/open', {});
  if (d.status !== 200) throw new Error(JSON.stringify(d.body));
  const c = await g.post('/api/cash/open', { openingCents });
  if (c.status !== 200) throw new Error(JSON.stringify(c.body));
  return g;
}

let keySeq = 0;
export function idemKey() {
  return `test-${Date.now()}-${keySeq++}-${Math.random().toString(36).slice(2, 8)}`;
}

export { setClock };
