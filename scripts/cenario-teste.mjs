// Preenche o ambiente de TESTES com um movimento fictício de lanchonete (mesas, comandas, cozinha,
// entregas e cardápio digital), para experimentar as telas "cheias" ou gerar capturas.
// Uso: node scripts/cenario-teste.mjs [http://localhost:3000]
// Todos os nomes, telefones e endereços são fictícios. Não use contra um servidor de produção.
import crypto from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const H = { 'content-type': 'application/json', 'x-requested-with': 'guto' };

async function session(username, password = 'demo1234') {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ username, password }) });
  if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, { method, headers: { ...H, cookie, 'idempotency-key': crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}) };
}

const gerente = await session('gerente');
const day = await gerente.get('/api/day');
if (!day.day) await gerente.post('/api/day/open');
if (!day.cash) await gerente.post('/api/cash/open', { openingCents: 10000 });

const menu = await gerente.get('/api/menu');
const products = menu.flatMap((c) => c.products);
const P = (name) => {
  const p = products.find((x) => x.name === name);
  if (!p) throw new Error(`produto ${name} não encontrado`);
  return p;
};
const opt = (p, name) => p.groups.flatMap((g) => g.options).find((o) => o.name === name)?.id;
const item = (name, quantity = 1, options = [], notes) => {
  const p = P(name);
  return { variantId: p.variants[0].id, quantity, options: options.map((o) => ({ optionId: opt(p, o), quantity: 1 })).filter((o) => o.optionId), notes };
};

const ana = await session('atendente1');
const beto = await session('atendente2');
const caixa = await session('caixa');
const cozinha = await session('cozinha');

const t1 = await ana.post('/api/orders', { type: 'table', tabKind: 'table', tableLabel: '2', send: true, items: [item('X-Bacon', 2, ['Cheddar', 'Sem cebola'], 'um deles bem passado'), item('Batata frita'), item('Refrigerante lata', 2)] });
await ana.post('/api/orders', { type: 'table', tabKind: 'table', tableLabel: '5', send: true, items: [item('X-Tudo', 1, [], 'cliente alérgico a amendoim — conferir molho, trocar o pão por pão sem gergelim e caprichar na batata palha')] });
const t7 = await beto.post('/api/orders', { type: 'table', tabKind: 'table', tableLabel: '7', send: true, items: [item('X-Picanha'), item('X-Egg Burguer', 1, ['Bacon extra'])] });
await beto.post('/api/orders', { type: 'table', tabKind: 'tab', tableLabel: '14', send: true, items: [item('Batata com cheddar e bacon'), item('Refrigerante lata', 3)] });
await ana.post('/api/orders', { type: 'table', tabKind: 'tab', tableLabel: '21', send: true, items: [item('X-Cabuloso', 1, ['Ovo extra'])] });
const t9 = await beto.post('/api/orders', { type: 'table', tabKind: 'table', tableLabel: '9', send: true, items: [item('X-Guto', 2), item('Refrigerante lata', 2)] });
// acréscimo na mesa 2 (nova rodada)
await ana.post(`/api/orders/${t1.id}/items`, { items: [item('X-Burguer', 1, [], 'sem maionese')], send: true });

// balcão e entrega lançados pelo caixa
await caixa.post('/api/orders', { type: 'counter', customer: { name: 'Cliente balcão' }, send: true, items: [item('X-Egg Bacon')] });
const hoods = await caixa.get('/api/neighborhoods');
const centro = hoods.find((h) => h.name === 'Centro');
const d1 = await caixa.post('/api/orders', {
  type: 'delivery', send: true, paymentIntent: 'cash', changeForCents: 5000,
  customer: { name: 'Maria Fictícia', phone: '11900000001' },
  address: { street: 'Rua das Laranjeiras', number: '120', complement: 'casa 2', reference: 'portão azul', neighborhoodId: centro.id },
  items: [item('X-Bacon'), item('Batata frita')],
});
await caixa.post('/api/orders', {
  type: 'delivery', send: true, paymentIntent: 'pix_manual',
  customer: { name: 'João Exemplo', phone: '11900000002' },
  address: { street: 'Avenida Brasil Imaginária', number: '45', neighborhoodId: hoods.find((h) => h.name === 'Vila Nova').id },
  items: [item('X-Tudo', 2)],
});

// cardápio digital (fica aguardando aceite)
await fetch(`${BASE}/api/public/orders`, {
  method: 'POST',
  headers: { ...H, 'idempotency-key': crypto.randomUUID() },
  body: JSON.stringify({ type: 'takeout', customer: { name: 'Pedido Online Teste', phone: '11900000003' }, items: [item('X-Burguer', 2)], paymentIntent: 'pix_manual', privacyAccepted: true }),
});

// andamento da cozinha: alguns em preparo, alguns prontos
const { tickets } = await cozinha.get('/api/kitchen');
const byOrder = (id) => tickets.filter((t) => t.orderId === id);
for (const t of [...byOrder(t7.id), ...byOrder(d1.id)]) {
  await cozinha.post(`/api/kitchen/tickets/${t.id}/status`, { status: 'preparing' });
  await cozinha.post(`/api/kitchen/tickets/${t.id}/status`, { status: 'ready' });
}
for (const t of byOrder(t1.id).slice(0, 1)) await cozinha.post(`/api/kitchen/tickets/${t.id}/status`, { status: 'preparing' });
for (const t of byOrder(t9.id)) {
  await cozinha.post(`/api/kitchen/tickets/${t.id}/status`, { status: 'preparing' });
  await cozinha.post(`/api/kitchen/tickets/${t.id}/status`, { status: 'ready' });
  await beto.post(`/api/kitchen/tickets/${t.id}/served`);
}
await beto.post(`/api/orders/${t9.id}/request-bill`);

console.log('Cenário fictício criado: mesas 2, 5, 7, 9 (conta pedida), comandas 14 e 21, balcão, 2 entregas e 1 pedido online.');
