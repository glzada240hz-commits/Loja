/* global crypto */
// Prepara uma loja de DEMONSTRAÇÃO para o vídeo comercial (clientes fictícios).
// Uso: node scripts/video/cenario.mjs http://localhost:3200
const B = process.argv[2] ?? 'http://localhost:3200';
const H = { 'content-type': 'application/json', 'x-requested-with': 'guto' };

async function session(username, password) {
  const r = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ username, password }) });
  if (!r.ok) throw new Error(`login ${username}: ${r.status}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = async (method, url, body) => {
    const res = await fetch(B + url, { method, headers: { ...H, cookie, 'idempotency-key': crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined });
    const txt = await res.text();
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${txt.slice(0, 200)}`);
    return txt ? JSON.parse(txt) : null;
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b) };
}

const admin = await session('admin', 'admin-e2e-123');
const ana = await session('atendente1', 'demo1234');
const beto = await session('atendente2', 'demo1234');
const cozinha = await session('cozinha', 'demo1234');

await admin.post('/api/menu/import-official', { archiveExamples: true, updateStore: true });
await admin.put('/api/settings', { storeName: 'Bar do Guto' });
await admin.post('/api/day/open', {});
await admin.post('/api/cash/open', { openingCents: 15000 });

const menu = await admin.get('/api/menu');
const P = menu.flatMap((c) => c.products);
const prod = (n) => P.find((p) => p.name === n);
const v = (n, i = 0) => prod(n).variants[i].id;
const opt = (n, g, o) => prod(n).groups.find((x) => x.name === g).options.find((x) => x.name === o).id;
const nb = (await admin.get('/api/neighborhoods'))[0].id;

// salão: mesas ocupadas em estados diferentes
const m2 = await ana.post('/api/orders', { type: 'table', tableLabel: '2', send: true, items: [{ variantId: v('X-Tudo'), quantity: 2, options: [{ optionId: opt('X-Tudo', 'Acréscimos', 'Bacon'), quantity: 1 }] }, { variantId: v('Heineken'), quantity: 2 }] });
const m5 = await beto.post('/api/orders', { type: 'table', tableLabel: '5', send: true, items: [{ variantId: v('Contra Filé c/ Fritas'), quantity: 1 }, { variantId: v('Brahma'), quantity: 3 }] });
const m8 = await ana.post('/api/orders', { type: 'table', tableLabel: '8', send: true, items: [{ variantId: v('X-Egg Bacon'), quantity: 1 }, { variantId: v('X-Picanha'), quantity: 1 }, { variantId: v('Fritas'), quantity: 1 }, { variantId: v('Coca-Cola 2L'), quantity: 1 }] });
await beto.post('/api/orders', { type: 'table', tableLabel: '11', send: true, items: [{ variantId: v('Omelete Especial'), quantity: 1 }, { variantId: v('Suco 1L'), quantity: 1 }] });
await ana.post('/api/orders', { type: 'table', tableLabel: '6', send: true, items: [{ variantId: v('Caipirinha'), quantity: 2 }, { variantId: v('Original'), quantity: 2 }] });

// cozinha: um em preparo, um pronto
const k = await cozinha.get('/api/kitchen');
const t5 = k.tickets.find((t) => t.orderNumber === m5.number);
await cozinha.post(`/api/kitchen/tickets/${t5.id}/status`, { status: 'preparing' });
const t8 = k.tickets.find((t) => t.orderNumber === m8.number);
await cozinha.post(`/api/kitchen/tickets/${t8.id}/status`, { status: 'preparing' });
await cozinha.post(`/api/kitchen/tickets/${t8.id}/status`, { status: 'ready' });
await ana.post(`/api/orders/${m2.id}/request-bill`, {}).catch(() => undefined);

// delivery pelo WhatsApp e balcão
await admin.post('/api/orders', {
  type: 'delivery', source: 'whatsapp', send: true, customer: { name: 'Juliana Prado', phone: '(31) 98100-2233' },
  address: { street: 'Rua das Acácias', number: '120', neighborhoodId: nb }, items: [{ variantId: v('Fritas c/ Cheddar e Bacon'), quantity: 1 }, { variantId: v('Coca-Cola 2L'), quantity: 1 }],
  paymentPlan: [{ method: 'pix_manual', amountCents: 3000 }, { method: 'cash', amountCents: 3290 }], paymentIntent: 'cash', changeForCents: 5000,
});
await admin.post('/api/orders', { type: 'takeout', send: true, customer: { name: 'Rafael', phone: null }, items: [{ variantId: v('X-Guto'), quantity: 2 }] });

// pedido do cardápio digital aguardando aceite
await fetch(`${B}/api/public/orders`, {
  method: 'POST', headers: { ...H, 'idempotency-key': crypto.randomUUID() },
  body: JSON.stringify({ type: 'takeout', customer: { name: 'Marcos Lima', phone: '(31) 97700-4455' }, items: [{ variantId: v('X-Cabuloso'), quantity: 1 }], paymentIntent: 'pix_manual', privacyAccepted: true }),
});
console.log('cenário pronto:', { mesa8: m8.id, mesa2: m2.id });
