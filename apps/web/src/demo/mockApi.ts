/**
 * Servidor SIMULADO para a demonstração no navegador.
 * Reproduz as regras principais da API real (preço no "servidor", permissões, versão, idempotência,
 * dia operacional, caixa, cozinha, entregas, WhatsApp demo) usando o mesmo pacote @guto/core.
 * Os dados ficam só no navegador de quem abre a demonstração. Não substitui o servidor real.
 */
import {
  can,
  cashPayment,
  computeOrderTotals,
  effectiveDiscountBp,
  localDateISO,
  localHour,
  normalizePhoneBR,
  phoneVariantsBR,
  ROLE_PERMISSIONS,
  splitEvenly,
  stageFromTickets,
  unitTotal,
  validateOptionSelections,
  formatBRL,
  formatTime,
  ORDER_STAGE_LABEL,
  type KitchenStatus,
  type Permission,
  type Role,
} from '@guto/core';

// ---------------------------------------------------------------- utilidades

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
const err = (status: number, code: string, message: string, details?: unknown) => new HttpError(status, code, message, details);
const uid = () => (crypto.randomUUID?.() ?? 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const nowIso = () => new Date().toISOString();
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');

const STORAGE_KEY = 'guto-demo-state-v1';
const SESSION_KEY = 'guto-demo-session-v1';

type Any = any;

interface User { id: string; name: string; username: string; role: Role; active: boolean; password: string; lastLoginAt: string | null }

interface State {
  users: User[];
  settings: Any;
  neighborhoods: Any[];
  categories: Any[];
  products: Any[]; // { id, categoryId, code, name, description, kind, available, active, showOnline, sort, variants: [], groupIds: [], combo: [] }
  groups: Any[]; // { id, name, minSelect, maxSelect, active, options: [] }
  stock: Any[];
  recipes: Any[]; // { variantId?, optionId?, stockItemId, quantity:number }
  stockMoves: Any[];
  couriers: Any[];
  days: Any[];
  cashSessions: Any[];
  cashMoves: Any[];
  orders: Any[];
  runs: Any[];
  adjustments: Any[];
  settlements: Any[];
  customers: Any[];
  expenses: Any[];
  audit: Any[];
  waContacts: Any[];
  waMessages: Any[];
  quickReplies: Any[];
  templates: Any[];
  idem: Record<string, { hash: string; response: Any }>;
}

let S: State;
let sessionUserId: string | null = null;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
  } catch {
    /* armazenamento indisponível: a demonstração continua só em memória */
  }
}
function saveSession() {
  try {
    if (sessionUserId) localStorage.setItem(SESSION_KEY, sessionUserId);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignora */
  }
}

// ---------------------------------------------------------------- dados iniciais

function seed(): State {
  const u = (username: string, name: string, role: Role): User => ({ id: uid(), name, username, role, active: true, password: 'demo1234', lastLoginAt: null });
  const users = [u('admin', 'Administrador', 'admin'), u('gerente', 'Gerente Demo', 'manager'), u('caixa', 'Caixa Demo', 'cashier'), u('cozinha', 'Cozinha Demo', 'kitchen'), u('moto1', 'Entregador 1 (demo)', 'courier'), u('moto2', 'Entregador 2 (demo)', 'courier')];
  const cat = (name: string, sort: number, sendToKitchen = true) => ({ id: uid(), name, sort, sendToKitchen, active: true });
  const lanches = cat('Lanches', 1), porcoes = cat('Porções', 2), combos = cat('Combos', 3), bebidas = cat('Bebidas', 4, false);
  const opt = (name: string, priceCents: number, costCents: number | null) => ({ id: uid(), name, priceCents, costCents, available: true, active: true });
  const cheddar = opt('Cheddar', 400, 120), baconX = opt('Bacon extra', 500, 180), ovoX = opt('Ovo extra', 300, 70);
  const adicionais = { id: uid(), name: 'Adicionais', minSelect: 0, maxSelect: 5, active: true, options: [cheddar, baconX, ovoX] };
  const retirar = { id: uid(), name: 'Retirar ingredientes', minSelect: 0, maxSelect: 0, active: true, options: ['Sem cebola', 'Sem tomate', 'Sem alface', 'Sem maionese'].map((n) => opt(n, 0, 0)) };
  const st = (name: string, unit: string, quantity: number, minQuantity: number, unitCostCents: number) => ({ id: uid(), name, unit, quantity, minQuantity, unitCostCents });
  const stock = [
    st('Pão de hambúrguer', 'un', 50, 20, 120), st('Hambúrguer bovino 120g', 'un', 60, 20, 450), st('Queijo mussarela (fatia)', 'fatia', 200, 50, 60),
    st('Ovo', 'un', 90, 30, 70), st('Bacon', 'g', 3000, 800, 6), st('Cheddar cremoso', 'g', 2000, 500, 4), st('Picanha (bife)', 'un', 20, 8, 1200),
    st('Batata congelada', 'g', 10000, 3000, 2.2), st('Refrigerante lata', 'un', 48, 24, 320),
  ];
  const sid = (n: string) => stock.find((s) => s.name === n)!.id;
  const recipes: Any[] = [
    { optionId: cheddar.id, stockItemId: sid('Cheddar cremoso'), quantity: 30 },
    { optionId: baconX.id, stockItemId: sid('Bacon'), quantity: 30 },
    { optionId: ovoX.id, stockItemId: sid('Ovo'), quantity: 1 },
  ];
  const base = [['Pão de hambúrguer', 1], ['Hambúrguer bovino 120g', 1], ['Queijo mussarela (fatia)', 1]] as [string, number][];
  const products: Any[] = [];
  const prod = (categoryId: string, code: string, name: string, priceCents: number, costCents: number | null, description: string, groupIds: string[], rec: [string, number][], extra: Any = {}) => {
    const v = { id: uid(), name: 'Único', priceCents, costCents, available: true, active: true };
    products.push({ id: uid(), categoryId, code, name, description, imagePath: null, kind: 'simple', available: true, active: true, showOnline: true, sort: products.length, variants: [v], groupIds, combo: [], ...extra });
    for (const [n, q] of rec) recipes.push({ variantId: v.id, stockItemId: sid(n), quantity: q });
    return v;
  };
  const lg = [adicionais.id, retirar.id];
  const xb = prod(lanches.id, '1', 'X-Burguer', 1350, 550, 'Pão, hambúrguer, queijo, alface, tomate e maionese.', lg, base);
  prod(lanches.id, '2', 'X-Egg Burguer', 1550, 640, 'X-Burguer com ovo.', lg, [...base, ['Ovo', 1]]);
  prod(lanches.id, '3', 'X-Bacon', 1890, 780, 'X-Burguer com bacon.', lg, [...base, ['Bacon', 40]]);
  prod(lanches.id, '4', 'X-Egg Bacon', 1890, 850, 'X-Burguer com ovo e bacon.', lg, [...base, ['Ovo', 1], ['Bacon', 40]]);
  prod(lanches.id, '5', 'X-Guto', 1990, 900, 'Receita da casa. (descrição demonstrativa)', lg, [...base, ['Ovo', 1], ['Bacon', 30], ['Cheddar cremoso', 20]]);
  prod(lanches.id, '6', 'X-Tudo', 2190, 1050, 'Hambúrguer, queijo, ovo, bacon, presunto, alface e tomate.', lg, [...base, ['Ovo', 1], ['Bacon', 40]]);
  prod(lanches.id, '7', 'X-Picanha', 2590, 1500, 'Pão, bife de picanha, queijo e salada.', lg, [['Pão de hambúrguer', 1], ['Picanha (bife)', 1], ['Queijo mussarela (fatia)', 1]]);
  prod(lanches.id, '8', 'X-Cabuloso', 2390, 1150, 'Duplo hambúrguer, bacon, cheddar e ovo. (descrição demonstrativa)', lg, [['Pão de hambúrguer', 1], ['Hambúrguer bovino 120g', 2], ['Bacon', 40], ['Cheddar cremoso', 30], ['Ovo', 1]]);
  const bf = prod(porcoes.id, '20', 'Batata frita', 2290, 800, 'Porção de batata frita.', [adicionais.id], [['Batata congelada', 400]]);
  prod(porcoes.id, '21', 'Batata com cheddar e bacon', 4090, 1600, 'Porção de batata com cheddar e bacon.', [], [['Batata congelada', 500], ['Cheddar cremoso', 120], ['Bacon', 100]]);
  const rf = prod(bebidas.id, '30', 'Refrigerante lata', 600, 320, 'PREÇO DEMONSTRATIVO — revise antes do uso.', [], [['Refrigerante lata', 1]]);
  prod(combos.id, '40', 'Combo X-Burguer + Batata + Refri', 3990, 1670, 'EXEMPLO DE COMBO — preço demonstrativo, revise antes do uso.', [retirar.id], [], {
    kind: 'combo',
    combo: [{ variantId: xb.id, quantity: 1 }, { variantId: bf.id, quantity: 1 }, { variantId: rf.id, quantity: 1 }],
  });
  return {
    users,
    settings: {
      storeName: 'Bar do Guto', storePhone: '(11) 90000-0000', storeAddress: 'Endereço demonstrativo — configure em Ajustes',
      onlineOrdersEnabled: true, onlineMinOrderCents: 0, pickupEtaMinutes: 25, deliveryEtaMinutes: 50, cashierMaxDiscountBp: 1000,
      kitchenLateMinutes: 20, duplicateWindowMinutes: 15, tables: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      onlinePaymentMethods: ['cash', 'pix_manual', 'credit', 'debit'], pixKeyDisplay: '', printWidth: 80, receiptFooter: 'Obrigado pela preferência!',
      waAutoReplyEnabled: true, waGreeting: 'Olá! Você está falando com o Bar do Guto. Responda:\n1 - Cardápio e pedidos\n2 - Status do meu pedido\n3 - Falar com atendente', dataRetentionMonths: 24,
    },
    neighborhoods: [
      { id: uid(), name: 'Centro', feeCents: 500, courierFeeCents: 400, minOrderCents: 0, etaMinutes: 40, active: true },
      { id: uid(), name: 'Vila Nova', feeCents: 700, courierFeeCents: 500, minOrderCents: 0, etaMinutes: 45, active: true },
      { id: uid(), name: 'Jardim das Flores', feeCents: 900, courierFeeCents: 600, minOrderCents: 3000, etaMinutes: 55, active: true },
    ],
    categories: [lanches, porcoes, combos, bebidas],
    products,
    groups: [adicionais, retirar],
    stock,
    recipes,
    stockMoves: stock.map((s) => ({ id: uid(), stockItemId: s.id, type: 'entry', quantity: s.quantity, reason: 'Estoque inicial (demonstração)', sourceType: null, createdAt: nowIso(), userId: users[0]!.id })),
    couriers: [
      { id: uid(), name: 'Entregador 1 (demo)', phone: '5511900000001', userId: users[4]!.id, defaultFeeCents: 500, active: true },
      { id: uid(), name: 'Entregador 2 (demo)', phone: '5511900000002', userId: users[5]!.id, defaultFeeCents: 500, active: true },
    ],
    days: [], cashSessions: [], cashMoves: [], orders: [], runs: [], adjustments: [], settlements: [], customers: [], expenses: [], audit: [],
    waContacts: [], waMessages: [],
    quickReplies: [
      { id: uid(), title: 'Cardápio', body: 'Confira nosso cardápio e peça por aqui: {link do cardápio}', sort: 1 },
      { id: uid(), title: 'Tempo de entrega', body: 'No momento estamos entregando em cerca de 50 minutos.', sort: 2 },
    ],
    templates: [],
    idem: {},
  };
}

/** Prepara um ambiente pronto para testar: dia e caixa abertos e alguns pedidos de exemplo. */
function seedScenario() {
  const g = S.users.find((u) => u.username === 'gerente')!;
  const caixa = S.users.find((u) => u.username === 'caixa')!;
  const day = { id: uid(), referenceDate: localDateISO(new Date()), status: 'open', openedAt: nowIso(), openedBy: g.id, closedAt: null, lastOrderNumber: 0 };
  S.days.push(day);
  const cs = { id: uid(), businessDayId: day.id, status: 'open', openedAt: nowIso(), openedBy: g.id, openingCents: 10000, closedAt: null, expectedCashCents: null, countedCashCents: null, differenceCents: null, justification: null };
  S.cashSessions.push(cs);
  S.cashMoves.push({ id: uid(), cashSessionId: cs.id, type: 'opening', method: 'cash', amountCents: 10000, reason: 'Fundo de troco', orderId: null, paymentId: null, createdBy: g.id, createdAt: nowIso() });
  const v = (name: string) => S.products.find((p) => p.name === name)!.variants[0].id;
  const o = (name: string) => S.groups.flatMap((x) => x.options).find((x: Any) => x.name === name)!.id;
  const actor = { id: caixa.id, role: caixa.role as Role, name: caixa.name };
  createOrder(actor, { type: 'table', tableLabel: '4', items: [{ variantId: v('X-Tudo'), quantity: 2 }, { variantId: v('Refrigerante lata'), quantity: 2 }] }, 'pos');
  createOrder(actor, { type: 'counter', customer: { name: 'João', phone: '11 98888-1111' }, items: [{ variantId: v('X-Bacon'), quantity: 1, options: [{ optionId: o('Cheddar'), quantity: 1 }, { optionId: o('Sem cebola'), quantity: 1 }], notes: 'bem passado' }] }, 'pos');
  createOrder(null, {
    type: 'delivery', customer: { name: 'Ana Cliente', phone: '11 96666-5555' },
    address: { street: 'Rua das Flores', number: '120', neighborhoodId: S.neighborhoods[0].id }, items: [{ variantId: v('X-Cabuloso'), quantity: 1 }, { variantId: v('Batata frita'), quantity: 1 }],
    paymentIntent: 'cash', changeForCents: 10000, waOptIn: true,
  }, 'online');
}

export function resetDemo() {
  S = seed();
  seedScenario();
  sessionUserId = null;
  save();
  saveSession();
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      S = JSON.parse(raw);
      sessionUserId = localStorage.getItem(SESSION_KEY);
      return;
    }
  } catch {
    /* recria abaixo */
  }
  resetDemo();
}

// ---------------------------------------------------------------- eventos em tempo real (simulados)

type Listener = (ev: Any) => void;
const listeners = new Set<Listener>();
function publish(ev: Any) {
  setTimeout(() => listeners.forEach((l) => l(ev)), 0);
}

class FakeEventSource {
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private named: Record<string, ((e: Any) => void)[]> = {};
  private l: Listener;
  constructor(_url: string) {
    this.l = (ev) => this.onmessage?.({ data: JSON.stringify(ev) });
    listeners.add(this.l);
    setTimeout(() => this.named.hello?.forEach((f) => f({ data: '{}' })), 30);
  }
  addEventListener(type: string, fn: (e: Any) => void) {
    (this.named[type] ??= []).push(fn);
  }
  close() {
    listeners.delete(this.l);
  }
}

// ---------------------------------------------------------------- autenticação e permissões

interface Actor { id: string; role: Role; name: string }

function me(): Actor {
  const u = S.users.find((x) => x.id === sessionUserId && x.active);
  if (!u) throw err(401, 'unauthorized', 'Faça login para continuar');
  return { id: u.id, role: u.role, name: u.name };
}
function need(a: Actor, p: Permission) {
  if (!can(a.role, p)) throw err(403, 'forbidden', 'Seu perfil não tem permissão para esta ação');
}
/** Autorização do gerente (mesma regra do servidor real). */
function authorize(a: Actor, p: Permission, sup?: { username: string; password: string } | null): string | null {
  if (can(a.role, p)) return null;
  if (!sup) throw err(403, 'supervisor_required', 'Esta ação exige autorização de um gerente', { permission: p });
  const u = S.users.find((x) => x.username === sup.username.trim().toLowerCase() && x.active);
  if (!u || u.password !== sup.password) throw err(401, 'invalid_credentials', 'Usuário ou senha incorretos');
  if (!can(u.role, p)) throw err(403, 'forbidden', 'O usuário informado não tem permissão para autorizar esta ação');
  return u.id;
}
const userName = (id: string | null | undefined) => (id ? (S.users.find((u) => u.id === id)?.name ?? null) : null);
function audit(a: Actor | null, action: string, entity: string, entityId: string | null, data?: Any, authorizedBy?: string | null) {
  S.audit.unshift({ id: S.audit.length + 1, action, entity, entityId, data: data ?? null, createdAt: nowIso(), userId: a?.id ?? null, authorizedBy: authorizedBy ?? null });
}

// ---------------------------------------------------------------- dia e caixa

const openDay = () => S.days.find((d) => d.status === 'open') ?? null;
function requireDay() {
  const d = openDay();
  if (!d) throw err(409, 'day_closed', 'Nenhum dia operacional aberto. Abra o dia para registrar pedidos.');
  return d;
}
const openCash = () => S.cashSessions.find((c) => c.status === 'open') ?? null;
function requireCash() {
  const c = openCash();
  if (!c) throw err(409, 'cash_closed', 'Abra o caixa para registrar pagamentos e movimentações');
  return c;
}
const cashBalance = (sid: string) => S.cashMoves.filter((m) => m.cashSessionId === sid && m.method === 'cash').reduce((a, m) => a + m.amountCents, 0);
function cashSummary(sid: string) {
  const byMethod: Any = {};
  let supplies = 0, withdrawals = 0, opening = 0, courierPayouts = 0, expensesPaid = 0;
  for (const m of S.cashMoves.filter((x) => x.cashSessionId === sid)) {
    if (m.type === 'payment' || m.type === 'refund') {
      const t = (byMethod[m.method] ??= { received: 0, refunded: 0, net: 0 });
      if (m.type === 'payment') t.received += m.amountCents;
      else t.refunded += -m.amountCents;
      t.net += m.amountCents;
    } else if (m.type === 'supply') supplies += m.amountCents;
    else if (m.type === 'withdrawal') withdrawals += -m.amountCents;
    else if (m.type === 'opening') opening += m.amountCents;
    else if (m.type === 'courier_payout') courierPayouts += -m.amountCents;
    else if (m.type === 'expense') expensesPaid += -m.amountCents;
  }
  const totalReceived = Object.values(byMethod).reduce((a: number, m: Any) => a + m.net, 0);
  return { opening, supplies, withdrawals, courierPayouts, expensesPaid, byMethod, totalReceived, expectedCash: cashBalance(sid) };
}

// ---------------------------------------------------------------- cardápio

function menuView(publicView = false) {
  return S.categories
    .filter((c) => c.active)
    .sort((a, b) => a.sort - b.sort)
    .map((c) => ({
      id: c.id, name: c.name, sort: c.sort, sendToKitchen: c.sendToKitchen,
      products: S.products
        .filter((p) => p.active && p.categoryId === c.id && (!publicView || p.showOnline))
        .sort((a, b) => a.sort - b.sort)
        .map((p) => ({
          id: p.id, categoryId: p.categoryId, code: p.code, name: p.name, description: p.description, imagePath: p.imagePath, kind: p.kind, available: p.available,
          showOnline: p.showOnline, sort: p.sort,
          variants: p.variants.filter((v: Any) => v.active).map((v: Any) => ({ id: v.id, name: v.name, priceCents: v.priceCents, costCents: publicView ? null : v.costCents, available: v.available })),
          groups: p.groupIds.map((gid: string) => S.groups.find((g) => g.id === gid && g.active)).filter(Boolean).map((g: Any) => ({
            id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect,
            options: g.options.filter((o: Any) => o.active).map((o: Any) => ({ id: o.id, name: o.name, priceCents: o.priceCents, costCents: publicView ? null : o.costCents, available: o.available, sort: 0 })),
          })),
          combo: p.combo.map((ci: Any) => ({ variantId: ci.variantId, quantity: ci.quantity, label: variantLabel(ci.variantId) })),
        }))
        .filter((p) => p.variants.length > 0),
    }))
    .filter((c) => !publicView || c.products.length > 0);
}
function variantLabel(variantId: string) {
  for (const p of S.products) for (const v of p.variants) if (v.id === variantId) return v.name === 'Único' ? p.name : `${p.name} ${v.name}`;
  return '?';
}

function resolveItems(inputs: Any[], online = false) {
  if (!inputs?.length) throw err(422, 'unprocessable', 'O pedido precisa de pelo menos um item');
  const menu = menuView();
  const errors: string[] = [];
  const out: Any[] = [];
  for (const input of inputs) {
    let ref: Any = null;
    for (const cat of menu) for (const prod of cat.products) for (const v of prod.variants) if (v.id === input.variantId) ref = { cat, prod, v };
    if (!ref) {
      errors.push('Produto não encontrado ou removido do cardápio');
      continue;
    }
    const { cat, prod, v } = ref;
    const label = v.name === 'Único' ? prod.name : `${prod.name} (${v.name})`;
    if (!prod.available || !v.available) errors.push(`${label} está indisponível no momento`);
    if (online && !prod.showOnline) errors.push(`${label} não está disponível no cardápio digital`);
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) {
      errors.push(`Quantidade inválida para ${label}`);
      continue;
    }
    const sel = input.options ?? [];
    const se = validateOptionSelections(prod.groups.map((g: Any) => ({ ...g, options: g.options.map((o: Any) => ({ id: o.id, name: o.name, available: o.available })) })), sel);
    errors.push(...se.map((e) => `${label}: ${e}`));
    if (se.length) continue;
    const options = sel.map((s: Any) => {
      const g = prod.groups.find((gg: Any) => gg.options.some((o: Any) => o.id === s.optionId));
      const o = g.options.find((oo: Any) => oo.id === s.optionId);
      return { id: uid(), optionId: o.id, groupName: g.name, optionName: o.name, priceCents: o.priceCents, costCents: o.costCents, quantity: s.quantity };
    });
    const unit = unitTotal({ unitPriceCents: v.priceCents, options });
    let unitCost: number | null = v.costCents;
    for (const o of options) {
      if (o.costCents == null) {
        if (o.priceCents > 0) unitCost = null;
      } else if (unitCost != null) unitCost += o.costCents * o.quantity;
    }
    out.push({
      id: uid(), productId: prod.id, variantId: v.id, productName: prod.name, variantName: v.name === 'Único' ? null : v.name, categoryName: cat.name,
      sendToKitchen: cat.sendToKitchen, quantity: input.quantity, unitPriceCents: v.priceCents, optionsUnitCents: unit - v.priceCents, totalCents: unit * input.quantity,
      unitCostCents: unitCost, notes: input.notes?.trim().slice(0, 300) || null, comboComponents: prod.kind === 'combo' ? prod.combo : null, status: 'active',
      cancelReason: null, ticketId: null, sentAt: null, stockDeducted: false, options,
    });
  }
  if (errors.length) throw err(422, 'unprocessable', errors[0]!, { errors });
  return out;
}

// ---------------------------------------------------------------- estoque

function consumption(item: Any) {
  const m = new Map<string, number>();
  const add = (id: string, q: number) => m.set(id, (m.get(id) ?? 0) + q);
  const vs = [{ id: item.variantId, mult: item.quantity }, ...((item.comboComponents ?? []) as Any[]).map((c) => ({ id: c.variantId, mult: item.quantity * c.quantity }))];
  for (const v of vs) for (const r of S.recipes.filter((x) => x.variantId === v.id)) add(r.stockItemId, r.quantity * v.mult);
  for (const o of item.options) for (const r of S.recipes.filter((x) => x.optionId === o.optionId)) add(r.stockItemId, r.quantity * o.quantity * item.quantity);
  return m;
}
function stockMove(stockItemId: string, type: string, quantity: number, reason: string | null, sourceId: string | null, a: Actor | null) {
  // um mesmo item de pedido nunca baixa/estorna duas vezes
  if (sourceId && S.stockMoves.some((x) => x.sourceId === sourceId && x.stockItemId === stockItemId && x.type === type)) return;
  const s = S.stock.find((x) => x.id === stockItemId);
  if (!s) return;
  s.quantity = Math.round((s.quantity + quantity) * 1000) / 1000;
  S.stockMoves.unshift({ id: uid(), stockItemId, type, quantity, reason, sourceType: sourceId ? 'order_item' : null, sourceId, createdAt: nowIso(), userId: a?.id ?? null });
}
function reverseItem(item: Any, mode: 'return' | 'loss', a: Actor | null, reason: string) {
  for (const s of S.stockMoves.filter((x) => x.sourceId === item.id && x.type === 'sale')) {
    stockMove(s.stockItemId, 'sale_reversal', -s.quantity, reason, item.id, a);
    if (mode === 'loss') stockMove(s.stockItemId, 'loss', s.quantity, reason, item.id, a);
  }
}

// ---------------------------------------------------------------- pedidos

const findOrder = (id: string) => {
  const o = S.orders.find((x) => x.id === id);
  if (!o) throw err(404, 'not_found', 'Pedido não encontrado');
  return o;
};
function event(o: Any, type: string, a: Actor | null, data?: Any, authorizedBy?: string | null) {
  o.events.push({ id: o.events.length + 1, type, data: data ?? null, createdAt: nowIso(), userName: a?.name ?? null, authorizedByName: userName(authorizedBy) });
}
function checkVersion(o: Any, v: number) {
  if (o.version !== v) throw err(409, 'stale_version', 'Este pedido foi alterado em outro dispositivo. Recarregue para ver a versão atual.');
}
function requireEditable(o: Any) {
  if (o.status === 'closed') throw err(409, 'order_closed', 'Pedido finalizado. Reabra o pedido para alterá-lo.');
  if (o.status === 'cancelled') throw err(409, 'order_cancelled', 'Pedido cancelado não pode ser alterado');
}
function recalc(o: Any) {
  const t = computeOrderTotals({
    items: o.items.map((i: Any) => ({ unitPriceCents: i.unitPriceCents, quantity: i.quantity, cancelled: i.status === 'cancelled', options: i.options })),
    discount: o.discountType ? { type: o.discountType, value: o.discountValue } : null,
    deliveryFeeCents: o.deliveryFeeCents,
  });
  if (t.totalCents < o.paidCents) throw err(422, 'total_below_paid', 'O novo total fica abaixo do valor já pago. Estorne um pagamento antes.');
  o.subtotalCents = t.subtotalCents;
  o.discountCents = t.discountCents;
  o.totalCents = t.totalCents;
}
const summary = (items: Any[]) => items.map((i) => `${i.quantity}x ${i.productName}${i.variantName ? ' ' + i.variantName : ''}`).join(', ');

function refreshStage(o: Any) {
  if (o.status === 'cancelled' || o.status === 'pending') return;
  if (o.stage === 'out_for_delivery' || (o.stage === 'delivered' && o.type === 'delivery')) return;
  const statuses = o.tickets.filter((t: Any) => o.items.some((i: Any) => i.ticketId === t.id && i.status === 'active')).map((t: Any) => t.status as KitchenStatus);
  const stage = stageFromTickets(statuses);
  if (o.stage === 'delivered' && stage === 'ready') return;
  if (stage === o.stage) return;
  o.stage = stage;
  if (stage === 'ready' && !o.readyAt) o.readyAt = nowIso();
  event(o, 'stage', null, { to: stage });
  if (stage === 'ready' && o.type === 'takeout') notify(o, 'order_ready');
}

function launch(o: Any, a: Actor | null) {
  const pending = o.items.filter((i: Any) => i.status === 'active' && !i.sentAt);
  if (!pending.length) return;
  let ticketId: string | null = null;
  if (pending.some((i: Any) => i.sendToKitchen)) {
    const t = { id: uid(), round: o.tickets.length + 1, status: 'received', createdAt: nowIso(), startedAt: null, readyAt: null, changedAt: null, changeNote: null };
    o.tickets.push(t);
    ticketId = t.id;
  }
  for (const i of pending) {
    for (const [sid, q] of consumption(i)) stockMove(sid, 'sale', -q, null, i.id, a);
    i.stockDeducted = true;
    i.sentAt = nowIso();
    i.ticketId = i.sendToKitchen ? ticketId : null;
  }
  event(o, 'items.sent', a, { items: summary(pending) });
  refreshStage(o);
}

function upsertCustomer(c: Any, address: Any, nbName: string | null) {
  const name = c?.name?.trim() || null;
  const phone = c?.phone ? normalizePhoneBR(c.phone) : null;
  if (c?.phone && !phone) throw err(400, 'bad_request', 'Telefone inválido');
  if (!phone) return { customerId: null, name, phone: null };
  let cu = S.customers.find((x) => x.phone === phone);
  if (!cu) {
    cu = { id: uid(), name: name ?? 'Cliente', phone, notes: null, addresses: [], createdAt: nowIso(), anonymizedAt: null };
    S.customers.push(cu);
  } else if (name) cu.name = name;
  if (address && nbName) {
    const same = cu.addresses.find((x: Any) => x.street === address.street.trim() && x.number === address.number.trim());
    const vals = { street: address.street.trim(), number: address.number.trim(), complement: address.complement || null, reference: address.reference || null, neighborhoodId: address.neighborhoodId, neighborhoodName: nbName, lastUsedAt: nowIso() };
    if (same) Object.assign(same, vals);
    else cu.addresses.unshift({ id: uid(), ...vals });
  }
  return { customerId: cu.id, name: name ?? cu.name, phone };
}

function nb(id: string) {
  const n = S.neighborhoods.find((x) => x.id === id);
  if (!n || !n.active) throw err(422, 'unprocessable', 'Bairro não atendido');
  return n;
}

function discountOk(a: Actor, subtotal: number, d: Any, sup: Any) {
  if (!d) return null;
  if (!d.reason?.trim()) throw err(422, 'unprocessable', 'Informe o motivo do desconto');
  const cents = computeOrderTotals({ items: [{ unitPriceCents: subtotal, quantity: 1, options: [] }], discount: d, deliveryFeeCents: 0 }).discountCents;
  if (can(a.role, 'orders.discount.unlimited')) return null;
  if (can(a.role, 'orders.discount') && effectiveDiscountBp(subtotal, cents) <= S.settings.cashierMaxDiscountBp) return null;
  return authorize(a, 'orders.discount.unlimited', sup);
}

function createOrder(a: Actor | null, input: Any, source: 'pos' | 'online', sup?: Any) {
  const day = requireDay();
  const items = resolveItems(input.items, source === 'online');
  const subtotal = items.reduce((x: number, i: Any) => x + i.totalCents, 0);
  let authorizedBy = source === 'pos' && a ? discountOk(a, subtotal, input.discount, sup) : null;
  let tableLabel: string | null = null;
  if (input.type === 'table') {
    tableLabel = input.tableLabel?.trim() || null;
    if (!tableLabel) throw err(422, 'unprocessable', 'Informe a mesa');
    const busy = S.orders.find((o) => o.businessDayId === day.id && o.tableLabel === tableLabel && ['open', 'pending'].includes(o.status));
    if (busy) throw err(409, 'table_busy', `A mesa ${tableLabel} já tem comanda aberta (#${busy.number})`, { id: busy.id, number: busy.number });
  }
  let n: Any = null;
  if (input.type === 'delivery') {
    const ad = input.address;
    if (!ad?.street?.trim() || !ad?.number?.trim() || !ad?.neighborhoodId) throw err(422, 'unprocessable', 'Endereço de entrega incompleto (rua, número e bairro)');
    n = nb(ad.neighborhoodId);
    if (!input.customer?.name?.trim() || !input.customer?.phone) throw err(422, 'unprocessable', 'Delivery exige nome e telefone do cliente');
  }
  let fee = n ? n.feeCents : 0;
  if (n && source === 'pos' && input.deliveryFeeCents != null && input.deliveryFeeCents !== n.feeCents && a) {
    authorizedBy = authorize(a, 'orders.delivery_fee_override', sup) ?? authorizedBy;
    fee = input.deliveryFeeCents;
  }
  const cust = upsertCustomer(input.customer, input.type === 'delivery' ? input.address : null, n?.name ?? null);
  if (source === 'online') {
    const min = Math.max(S.settings.onlineMinOrderCents, n?.minOrderCents ?? 0);
    if (subtotal < min) throw err(422, 'below_minimum', `Pedido abaixo do valor mínimo de ${formatBRL(min)}`, { minOrderCents: min });
  }
  if (!input.confirmDuplicate && (cust.phone || tableLabel) && source === 'pos') {
    const since = Date.now() - S.settings.duplicateWindowMinutes * 60000;
    const sig = (xs: Any[]) => xs.map((i) => `${i.variantId}x${i.quantity}`).sort().join('|');
    const s1 = sig(input.items);
    const dup = S.orders.find((o) => o.businessDayId === day.id && o.status !== 'cancelled' && new Date(o.createdAt).getTime() >= since && (cust.phone ? o.customerPhone === cust.phone : o.tableLabel === tableLabel) && sig(o.items.filter((i: Any) => i.status === 'active')) === s1);
    if (dup) throw err(409, 'possible_duplicate', `Pedido parecido registrado há pouco (#${dup.number}). Confirme se é um novo pedido.`, { id: dup.id, number: dup.number });
  }
  day.lastOrderNumber += 1;
  const eta = input.etaMinutes ?? (input.type === 'delivery' ? (n?.etaMinutes ?? S.settings.deliveryEtaMinutes) : input.type === 'takeout' ? S.settings.pickupEtaMinutes : null);
  const status = source === 'pos' ? 'open' : 'pending';
  const o: Any = {
    id: uid(), businessDayId: day.id, number: day.lastOrderNumber, type: input.type, source, status, stage: 'received', tableLabel,
    customerId: cust.customerId, customerName: cust.name, customerPhone: cust.phone,
    addrStreet: input.type === 'delivery' ? input.address.street.trim() : null, addrNumber: input.type === 'delivery' ? input.address.number.trim() : null,
    addrComplement: input.type === 'delivery' ? input.address.complement || null : null, addrReference: input.type === 'delivery' ? input.address.reference || null : null,
    neighborhoodId: n?.id ?? null, neighborhoodName: n?.name ?? null, notes: input.notes?.trim() || null,
    subtotalCents: 0, discountType: input.discount?.type ?? null, discountValue: input.discount?.value ?? null, discountCents: 0, discountReason: input.discount?.reason ?? null,
    deliveryFeeCents: fee, totalCents: 0, paidCents: 0, paymentIntent: input.paymentIntent ?? null, changeForCents: input.changeForCents ?? null,
    etaAt: eta ? new Date(Date.now() + eta * 60000).toISOString() : null, receivable: false, trackingToken: token(), waOptIn: !!input.waOptIn && !!cust.phone,
    courierId: null, deliveryRunId: null, deliveryStatus: input.type === 'delivery' ? 'waiting' : null, deliveryIssue: null, courierFeeCents: null, courierSettlementId: null,
    createdBy: source === 'pos' ? a?.id : null, createdAt: nowIso(), acceptedAt: status === 'open' ? nowIso() : null, readyAt: null, dispatchedAt: null, deliveredAt: null,
    closedAt: null, cancelledAt: null, cancelReason: null, version: 1, items, payments: [], tickets: [], events: [],
  };
  recalc(o);
  S.orders.push(o);
  event(o, 'created', source === 'pos' ? a : null, { source, type: input.type, items: summary(items), totalCents: o.totalCents, discount: input.discount ? { ...input.discount, cents: o.discountCents } : null, duplicateConfirmed: input.confirmDuplicate || undefined }, authorizedBy);
  if (status === 'open' && input.send !== false) launch(o, a);
  if (source !== 'pos') notify(o, 'order_received');
  publish({ type: 'order.changed', orderId: o.id });
  publish({ type: 'kitchen.changed', orderId: o.id });
  return o;
}

function orderView(o: Any) {
  return {
    ...o,
    courierName: S.couriers.find((c) => c.id === o.courierId)?.name ?? null,
    createdByName: userName(o.createdBy),
    balanceCents: o.totalCents - o.paidCents,
    payments: o.payments.map((p: Any) => ({ ...p, userName: userName(p.createdBy) })),
  };
}
function orderRow(o: Any) {
  return {
    id: o.id, number: o.number, businessDayId: o.businessDayId, type: o.type, source: o.source, status: o.status, stage: o.stage, tableLabel: o.tableLabel,
    customerName: o.customerName, customerPhone: o.customerPhone, addrStreet: o.addrStreet, addrNumber: o.addrNumber, neighborhoodName: o.neighborhoodName,
    totalCents: o.totalCents, paidCents: o.paidCents, receivable: o.receivable, deliveryStatus: o.deliveryStatus,
    courierName: S.couriers.find((c) => c.id === o.courierId)?.name ?? null, createdAt: o.createdAt, etaAt: o.etaAt, version: o.version,
    referenceDate: S.days.find((d) => d.id === o.businessDayId)?.referenceDate,
  };
}

function refund(o: Any, p: Any, a: Actor, reason: string, authorizedBy: string | null) {
  const cash = requireCash();
  if (p.status !== 'confirmed') throw err(409, 'conflict', 'Pagamento já estornado');
  p.status = 'refunded';
  p.refundReason = reason;
  p.refundedAt = nowIso();
  S.cashMoves.unshift({ id: uid(), cashSessionId: cash.id, type: 'refund', method: p.method, amountCents: -p.amountCents, reason, orderId: o.id, paymentId: p.id, createdBy: a.id, authorizedBy, createdAt: nowIso() });
  o.paidCents -= p.amountCents;
}

// ---------------------------------------------------------------- WhatsApp (modo demonstrativo)

const windowOpen = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 24 * 3600 * 1000;
function contactFor(phone: string, customerId?: string | null) {
  const vs = phoneVariantsBR(phone);
  let c = S.waContacts.find((x) => vs.includes(x.waId));
  if (!c) {
    c = { id: uid(), waId: phone, profileName: null, customerId: customerId ?? null, lastInboundAt: null, lastMessageAt: null, unreadCount: 0, botPaused: false, needsHuman: false, optInOrderUpdates: false, optInMarketing: false, optInAt: null, optInSource: null, optOutAt: null };
    S.waContacts.push(c);
  }
  if (customerId && !c.customerId) c.customerId = customerId;
  return c;
}
function outMsg(c: Any, body: string, extra: Any = {}) {
  const ok = extra.status !== 'failed';
  const m = { id: uid(), contactId: c.id, direction: 'out', wamid: ok ? 'demo.' + token() : null, type: 'text', body, templateName: null, status: ok ? 'sent' : 'failed', error: null, createdAt: nowIso(), automated: false, orderId: null, ...extra };
  S.waMessages.push(m);
  c.lastMessageAt = m.createdAt;
  // simula o recibo de entrega
  if (ok) setTimeout(() => {
    m.status = 'delivered';
    save();
    publish({ type: 'whatsapp.changed' });
  }, 1500);
  publish({ type: 'whatsapp.changed' });
  return m;
}
function notify(o: Any, purpose: string) {
  if (!o.waOptIn || !o.customerPhone) return;
  const c = contactFor(o.customerPhone, o.customerId);
  if (c.optOutAt) return;
  if (!c.optInOrderUpdates) Object.assign(c, { optInOrderUpdates: true, optInAt: o.createdAt, optInSource: o.source === 'online' ? 'cardapio_digital' : 'atendimento' });
  if (S.waMessages.some((m) => m.dedupeKey === `order:${o.id}:${purpose}`)) return;
  const store = S.settings.storeName;
  const n = `#${o.number}`;
  const text: Record<string, string> = {
    order_received: `${store}: recebemos seu pedido ${n} (total ${formatBRL(o.totalCents)}). Ele ainda será CONFIRMADO pela loja.`,
    order_accepted: `${store}: seu pedido ${n} foi confirmado pela loja.${o.etaAt ? ' Previsão: ' + formatTime(o.etaAt) + '.' : ''}`,
    order_ready: `${store}: seu pedido ${n} está pronto para retirada.`,
    order_dispatched: `${store}: seu pedido ${n} saiu para entrega.`,
    order_cancelled: `${store}: seu pedido ${n} foi cancelado. Se tiver dúvidas, responda esta mensagem.`,
  };
  const inWindow = windowOpen(c.lastInboundAt);
  const tpl = S.templates.find((t) => t.purpose === purpose && t.active);
  outMsg(c, text[purpose]!, {
    automated: true, orderId: o.id, dedupeKey: `order:${o.id}:${purpose}`,
    ...(inWindow ? {} : tpl ? { type: 'template', templateName: tpl.name } : { type: 'template', status: 'failed', error: `Fora da janela de 24h e sem template aprovado configurado para "${purpose}"` }),
  });
}
function inbound(phone: string, name: string, text: string) {
  const c = contactFor(phone);
  c.profileName = name;
  if (!c.customerId) c.customerId = S.customers.find((x) => phoneVariantsBR(phone).includes(x.phone))?.id ?? null;
  S.waMessages.push({ id: uid(), contactId: c.id, direction: 'in', wamid: 'demo.in.' + token(), type: 'text', body: text, status: 'received', createdAt: nowIso(), automated: false });
  c.lastInboundAt = c.lastMessageAt = nowIso();
  c.unreadCount += 1;
  const t = text.trim().toLowerCase();
  if (/^(parar|sair|stop)$/.test(t)) {
    Object.assign(c, { optOutAt: nowIso(), optInOrderUpdates: false, optInMarketing: false });
    outMsg(c, 'Pronto, você não receberá mais mensagens automáticas. Para voltar, responda VOLTAR.', { automated: true });
    return;
  }
  if (/^(voltar)$/.test(t) && c.optOutAt) {
    Object.assign(c, { optOutAt: null, optInOrderUpdates: true, optInAt: nowIso(), optInSource: 'whatsapp' });
    outMsg(c, 'Combinado! Você voltará a receber as atualizações dos seus pedidos.', { automated: true });
    return;
  }
  if (!S.settings.waAutoReplyEnabled || c.botPaused || c.needsHuman || c.optOutAt) return;
  if (/^(3|atendente|humano)$/.test(t)) {
    Object.assign(c, { needsHuman: true, botPaused: true });
    outMsg(c, 'Certo! Um atendente vai continuar a conversa em instantes.', { automated: true });
  } else if (/^(1|card[aá]pio|menu)$/.test(t)) {
    outMsg(c, 'Veja o cardápio com preços atualizados e faça seu pedido pelo cardápio digital.', { automated: true });
  } else if (/^(2|status|meu pedido)$/.test(t)) {
    const list = S.orders.filter((o) => phoneVariantsBR(c.waId).includes(o.customerPhone) && ['pending', 'open'].includes(o.status));
    outMsg(
      c,
      list.length
        ? list.map((o) => `Pedido #${o.number}: ${o.status === 'pending' ? 'aguardando confirmação da loja' : ORDER_STAGE_LABEL[o.stage as 'received'].toLowerCase()}.`).join('\n')
        : 'Não encontrei pedidos em andamento para este número. Responda 3 para falar com um atendente.',
      { automated: true },
    );
  } else {
    const last = [...S.waMessages].reverse().find((m) => m.contactId === c.id && m.direction === 'out' && m.automated);
    if (!last || Date.now() - new Date(last.createdAt).getTime() > 30 * 60000) outMsg(c, S.settings.waGreeting, { automated: true });
  }
}

// ---------------------------------------------------------------- roteador da API

type Params = Record<string, string> & { id: string; itemId: string; token: string; addressId: string };
type Handler = (p: { a: () => Actor; body: Any; params: Params; query: URLSearchParams; idem: string | null }) => Any;
const routes: [string, RegExp, string[], Handler][] = [];
function route(method: string, path: string, h: Handler) {
  const names: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$');
  routes.push([method, re, names, h]);
}
function idempotent(key: string | null, scope: string, body: Any, fn: () => Any) {
  if (!key) return fn();
  const k = scope + ':' + key;
  const hash = JSON.stringify(body);
  const prev = S.idem[k];
  if (prev) {
    if (prev.hash !== hash) throw err(422, 'idempotency_mismatch', 'Esta chave de requisição já foi usada com outros dados');
    return prev.response;
  }
  const r = fn();
  S.idem[k] = { hash, response: r };
  return r;
}

// --- auth
route('POST', '/api/auth/login', ({ body }) => {
  const u = S.users.find((x) => x.username === String(body.username ?? '').trim().toLowerCase() && x.active);
  if (!u || u.password !== body.password) throw err(401, 'invalid_credentials', 'Usuário ou senha incorretos');
  sessionUserId = u.id;
  u.lastLoginAt = nowIso();
  saveSession();
  return { user: { id: u.id, name: u.name, username: u.username, role: u.role }, permissions: [...ROLE_PERMISSIONS[u.role]] };
});
route('POST', '/api/auth/logout', () => {
  sessionUserId = null;
  saveSession();
  return { ok: true };
});
route('GET', '/api/auth/me', ({ a }) => {
  const x = a();
  const u = S.users.find((y) => y.id === x.id)!;
  return { user: { id: u.id, name: u.name, username: u.username, role: u.role }, permissions: [...ROLE_PERMISSIONS[u.role]] };
});
route('POST', '/api/auth/password', ({ a, body }) => {
  const u = S.users.find((y) => y.id === a().id)!;
  if (u.password !== body.current) throw err(401, 'invalid_credentials', 'Usuário ou senha incorretos');
  if (String(body.next).length < 8) throw err(422, 'unprocessable', 'A senha precisa ter pelo menos 8 caracteres');
  u.password = body.next;
  sessionUserId = null;
  saveSession();
  return { ok: true };
});

// --- dia e caixa
route('GET', '/api/day', ({ a }) => {
  a();
  const c = openCash();
  return { day: openDay(), cash: c ? { id: c.id, openedAt: c.openedAt, status: c.status } : null };
});
route('GET', '/api/days', () => [...S.days].reverse());
route('POST', '/api/day/open', ({ a }) => {
  const x = a();
  need(x, 'business_day.open');
  if (openDay()) throw err(409, 'conflict', 'Já existe um dia operacional aberto');
  const d = { id: uid(), referenceDate: localDateISO(new Date()), status: 'open', openedAt: nowIso(), openedBy: x.id, closedAt: null, lastOrderNumber: 0 };
  S.days.push(d);
  audit(x, 'business_day.open', 'business_day', d.id);
  publish({ type: 'day.changed' });
  return d;
});
route('POST', '/api/day/close', ({ a }) => {
  const x = a();
  need(x, 'business_day.manage');
  const d = openDay();
  if (!d) throw err(409, 'conflict', 'Não há dia operacional aberto');
  const pend = S.orders.filter((o) => o.businessDayId === d.id && ['pending', 'open'].includes(o.status));
  if (pend.length) throw err(409, 'day_has_open_orders', 'Finalize ou cancele os pedidos em aberto antes de fechar o dia', { orders: pend.map((o) => ({ id: o.id, number: o.number })) });
  if (openCash()) throw err(409, 'cash_open', 'Feche o caixa antes de fechar o dia');
  Object.assign(d, { status: 'closed', closedAt: nowIso(), closedBy: x.id });
  audit(x, 'business_day.close', 'business_day', d.id);
  publish({ type: 'day.changed' });
  return d;
});
route('GET', '/api/cash', ({ a }) => {
  const x = a();
  need(x, 'cash.open');
  const s = openCash() ?? null;
  if (!s) return null;
  const summ = cashSummary(s.id);
  const show = can(x.role, 'cash.view_expected');
  return {
    session: s,
    summary: show ? summ : { ...summ, expectedCash: null, byMethod: null, totalReceived: null },
    movements: S.cashMoves.filter((m) => m.cashSessionId === s.id).map((m) => ({ ...m, userName: userName(m.createdBy) })),
  };
});
route('GET', '/api/cash/sessions', ({ a }) => {
  need(a(), 'reports.view');
  return [...S.cashSessions].reverse();
});
route('POST', '/api/cash/open', ({ a, body }) => {
  const x = a();
  need(x, 'cash.open');
  const d = requireDay();
  if (openCash()) throw err(409, 'conflict', 'Já existe um caixa aberto');
  const s = { id: uid(), businessDayId: d.id, status: 'open', openedAt: nowIso(), openedBy: x.id, openingCents: body.openingCents ?? 0, closedAt: null, expectedCashCents: null, countedCashCents: null, differenceCents: null, justification: null };
  S.cashSessions.push(s);
  S.cashMoves.unshift({ id: uid(), cashSessionId: s.id, type: 'opening', method: 'cash', amountCents: s.openingCents, reason: 'Fundo de troco', createdBy: x.id, createdAt: nowIso() });
  publish({ type: 'cash.changed' });
  return s;
});
route('POST', '/api/cash/movements', ({ a, body, idem }) => {
  const x = a();
  need(x, 'cash.movement');
  return idempotent(idem, 'cash', body, () => {
    const s = requireCash();
    if (!body.amountCents || body.amountCents <= 0) throw err(400, 'bad_request', 'Valor deve ser positivo');
    if (body.type === 'withdrawal' && body.amountCents > cashBalance(s.id)) throw err(422, 'insufficient_cash', 'Sangria maior que o dinheiro em caixa');
    const m = { id: uid(), cashSessionId: s.id, type: body.type, method: 'cash', amountCents: body.type === 'withdrawal' ? -body.amountCents : body.amountCents, reason: body.reason, createdBy: x.id, createdAt: nowIso() };
    S.cashMoves.unshift(m);
    publish({ type: 'cash.changed' });
    return { id: m.id };
  });
});
route('POST', '/api/cash/close', ({ a, body }) => {
  const x = a();
  need(x, 'cash.open');
  const by = authorize(x, 'cash.close', body.supervisor);
  const s = openCash();
  if (!s) throw err(404, 'not_found', 'Nenhum caixa aberto');
  const summ = cashSummary(s.id);
  const diff = body.countedCashCents - summ.expectedCash;
  if (diff !== 0 && !body.justification?.trim()) throw err(422, 'justification_required', 'Há divergência entre o valor contado e o esperado. Informe a justificativa.', { differenceCents: diff });
  Object.assign(s, { status: 'closed', closedAt: nowIso(), closedBy: x.id, expectedCashCents: summ.expectedCash, countedCashCents: body.countedCashCents, differenceCents: diff, justification: body.justification || null });
  audit(x, 'cash.close', 'cash_session', s.id, { expected: summ.expectedCash, counted: body.countedCashCents, difference: diff }, by);
  publish({ type: 'cash.changed' });
  return { session: s, summary: summ };
});

// --- cardápio
route('GET', '/api/menu', ({ a }) => {
  const x = a();
  if (!(['orders.view', 'menu.manage', 'kitchen.view'] as Permission[]).some((p) => can(x.role, p))) throw err(403, 'forbidden', 'Seu perfil não tem permissão para esta ação');
  return menuView();
});
route('POST', '/api/menu/availability', ({ a, body }) => {
  need(a(), 'menu.manage');
  for (const p of S.products) {
    if (body.target === 'product' && p.id === body.id) p.available = body.available;
    for (const v of p.variants) if (body.target === 'variant' && v.id === body.id) v.available = body.available;
  }
  for (const g of S.groups) for (const o of g.options) if (body.target === 'option' && o.id === body.id) o.available = body.available;
  publish({ type: 'menu.changed' });
  return { ok: true };
});
route('POST', '/api/menu/categories', ({ a, body }) => {
  need(a(), 'menu.manage');
  let c = S.categories.find((x) => x.id === body.id);
  if (!c) S.categories.push((c = { id: uid(), active: true, sendToKitchen: true, sort: 0 }));
  Object.assign(c, { name: body.name, sort: body.sort ?? c.sort, sendToKitchen: body.sendToKitchen ?? c.sendToKitchen, active: body.active ?? true });
  publish({ type: 'menu.changed' });
  return c;
});
route('POST', '/api/menu/products', ({ a, body }) => {
  const x = a();
  need(x, 'menu.manage');
  let p = S.products.find((y) => y.id === body.id);
  if (!p) S.products.push((p = { id: uid(), imagePath: null, active: true, variants: [], groupIds: [], combo: [], sort: S.products.length }));
  const keep: Any[] = [];
  for (const v of body.variants) {
    const ex = p.variants.find((y: Any) => y.id === v.id);
    if (ex) keep.push(Object.assign(ex, { name: v.name || 'Único', priceCents: v.priceCents, costCents: v.costCents ?? null, available: v.available ?? true, active: true }));
    else keep.push({ id: uid(), name: v.name || 'Único', priceCents: v.priceCents, costCents: v.costCents ?? null, available: true, active: true });
  }
  for (const v of p.variants) if (!keep.includes(v)) keep.push({ ...v, active: false });
  Object.assign(p, {
    categoryId: body.categoryId, code: body.code || null, name: body.name, description: body.description || null, kind: body.kind ?? 'simple', available: body.available ?? true,
    showOnline: body.showOnline ?? true, variants: keep, groupIds: body.groupIds ?? p.groupIds, combo: body.combo ?? p.combo,
  });
  audit(x, 'menu.product.save', 'product', p.id, { name: p.name, variants: body.variants.map((v: Any) => ({ name: v.name, priceCents: v.priceCents })) });
  publish({ type: 'menu.changed' });
  return p;
});
route('DELETE', '/api/menu/products/:id', ({ a, params }) => {
  need(a(), 'menu.manage');
  const p = S.products.find((y) => y.id === params.id);
  if (p) p.active = false;
  publish({ type: 'menu.changed' });
  return { ok: true };
});
route('POST', '/api/menu/products/:id/image', () => {
  throw err(422, 'demo', 'Envio de fotos não está disponível na demonstração (funciona no sistema instalado).');
});
route('DELETE', '/api/menu/products/:id/image', ({ params }) => {
  const p = S.products.find((y) => y.id === params.id);
  if (p) p.imagePath = null;
  return p;
});
route('GET', '/api/menu/groups', () => S.groups.filter((g) => g.active).map((g) => ({ ...g, options: g.options.filter((o: Any) => o.active) })));
route('POST', '/api/menu/groups', ({ a, body }) => {
  need(a(), 'menu.manage');
  if (body.maxSelect > 0 && body.minSelect > body.maxSelect) throw err(400, 'bad_request', 'Limites de seleção inválidos');
  let g = S.groups.find((y) => y.id === body.id);
  if (!g) S.groups.push((g = { id: uid(), active: true, options: [] }));
  const opts = body.options.map((o: Any) => {
    const ex = g.options.find((y: Any) => y.id === o.id);
    return ex ? Object.assign(ex, { name: o.name, priceCents: o.priceCents, costCents: o.costCents ?? null, active: true }) : { id: uid(), name: o.name, priceCents: o.priceCents, costCents: o.costCents ?? null, available: true, active: true };
  });
  for (const o of g.options) if (!opts.includes(o)) opts.push({ ...o, active: false });
  Object.assign(g, { name: body.name, minSelect: body.minSelect, maxSelect: body.maxSelect, options: opts });
  publish({ type: 'menu.changed' });
  return g;
});
route('GET', '/api/menu/recipes', ({ query }) => {
  const v = query.get('variantId'), o = query.get('optionId');
  const items = S.recipes.filter((r) => (v ? r.variantId === v : r.optionId === o)).map((r) => {
    const s = S.stock.find((x) => x.id === r.stockItemId)!;
    return { id: uid(), stockItemId: r.stockItemId, quantity: String(r.quantity), name: s.name, unit: s.unit };
  });
  let cost = null;
  if (v) {
    let total = 0, complete = items.length > 0;
    for (const r of S.recipes.filter((x) => x.variantId === v)) {
      const s = S.stock.find((x) => x.id === r.stockItemId)!;
      if (s.unitCostCents == null) complete = false;
      else total += r.quantity * s.unitCostCents;
    }
    cost = { costCents: items.length ? Math.round(total) : null, complete };
  }
  return { items, cost };
});
route('PUT', '/api/menu/recipes', ({ a, body }) => {
  need(a(), 'menu.manage');
  S.recipes = S.recipes.filter((r) => !(body.variantId ? r.variantId === body.variantId : r.optionId === body.optionId));
  for (const i of body.items) S.recipes.push({ variantId: body.variantId, optionId: body.optionId, stockItemId: i.stockItemId, quantity: Number(i.quantity) });
  return [];
});

// --- estoque
route('GET', '/api/stock', ({ a }) => {
  need(a(), 'stock.view');
  return S.stock.map((s) => ({ ...s, quantity: s.quantity.toFixed(3), minQuantity: Number(s.minQuantity).toFixed(3), unitCostCents: s.unitCostCents == null ? null : String(s.unitCostCents), low: s.quantity <= s.minQuantity }));
});
route('POST', '/api/stock', ({ a, body }) => {
  need(a(), 'stock.manage');
  let s = S.stock.find((x) => x.id === body.id);
  if (!s) S.stock.push((s = { id: uid(), quantity: 0 }));
  Object.assign(s, { name: body.name, unit: body.unit, minQuantity: Number(body.minQuantity), unitCostCents: body.unitCostCents == null ? null : Number(body.unitCostCents) });
  publish({ type: 'stock.changed' });
  return s;
});
route('POST', '/api/stock/movements', ({ a, body }) => {
  const x = a();
  need(x, 'stock.manage');
  const s = S.stock.find((y) => y.id === body.stockItemId);
  if (!s) throw err(404, 'not_found', 'Insumo não encontrado');
  const q = Number(body.quantity);
  const delta = body.type === 'adjustment' ? q - s.quantity : body.type === 'entry' ? q : -q;
  stockMove(s.id, body.type, delta, body.reason, null, x);
  publish({ type: 'stock.changed' });
  return { delta };
});
route('GET', '/api/stock/movements', () =>
  S.stockMoves.slice(0, 200).map((m) => {
    const s = S.stock.find((x) => x.id === m.stockItemId);
    return { ...m, itemName: s?.name, unit: s?.unit, quantity: String(m.quantity), userName: userName(m.userId) };
  }),
);

// --- pedidos
route('GET', '/api/orders', ({ a, query }) => {
  need(a(), 'orders.view');
  const st = query.get('status')?.split(',').filter(Boolean);
  const q = query.get('q')?.trim().toLowerCase();
  let list = S.orders.filter((o) => {
    if (query.get('dayId') && o.businessDayId !== query.get('dayId')) return false;
    if (st?.length && !st.includes(o.status)) return false;
    if (query.get('type') && o.type !== query.get('type')) return false;
    if (query.get('receivable') === '1' && !(o.receivable && o.totalCents > o.paidCents)) return false;
    if (q) {
      const digits = q.replace(/\D/g, '');
      const hay = [o.customerName, o.addrStreet, o.neighborhoodName, o.tableLabel].filter(Boolean).join(' ').toLowerCase();
      if (!(hay.includes(q) || (/^\d{1,5}$/.test(q) && o.number === Number(q)) || (digits.length >= 4 && o.customerPhone?.includes(digits)))) return false;
    }
    return true;
  });
  list = [...list].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  return list.slice(0, Number(query.get('limit') ?? 200)).map(orderRow);
});
route('GET', '/api/orders/:id', ({ a, params }) => {
  need(a(), 'orders.view');
  return orderView(findOrder(params.id));
});
route('POST', '/api/orders', ({ a, body, idem }) => {
  const x = a();
  need(x, 'orders.create');
  const { supervisor, ...input } = body;
  return idempotent(idem, 'orders:' + x.id, input, () => orderView(createOrder(x, input, 'pos', supervisor)));
});
route('PATCH', '/api/orders/:id', ({ a, params, body }) => {
  const x = a();
  need(x, 'orders.edit');
  const o = findOrder(params.id);
  checkVersion(o, body.version);
  requireEditable(o);
  let by: string | null = null;
  if (body.deliveryFeeCents != null) by = authorize(x, 'orders.delivery_fee_override', body.supervisor);
  const type = body.type ?? o.type;
  if (type === 'table') {
    const label = (body.tableLabel ?? o.tableLabel)?.trim();
    if (!label) throw err(422, 'unprocessable', 'Informe a mesa');
    o.tableLabel = label;
  } else o.tableLabel = null;
  o.type = type;
  if (body.customer !== undefined || body.address !== undefined || body.type) {
    let n: Any = null;
    const ad = body.address ?? (o.addrStreet ? { street: o.addrStreet, number: o.addrNumber, complement: o.addrComplement, reference: o.addrReference, neighborhoodId: o.neighborhoodId } : null);
    if (type === 'delivery') {
      if (!ad?.street || !ad?.number || !ad?.neighborhoodId) throw err(422, 'unprocessable', 'Endereço de entrega incompleto (rua, número e bairro)');
      n = nb(ad.neighborhoodId);
    }
    const cust = upsertCustomer(body.customer ?? { name: o.customerName, phone: o.customerPhone }, type === 'delivery' ? ad : null, n?.name ?? null);
    Object.assign(o, {
      customerId: cust.customerId, customerName: cust.name, customerPhone: cust.phone,
      addrStreet: n ? ad.street : null, addrNumber: n ? ad.number : null, addrComplement: n ? ad.complement || null : null, addrReference: n ? ad.reference || null : null,
      neighborhoodId: n?.id ?? null, neighborhoodName: n?.name ?? null, deliveryFeeCents: n ? (body.deliveryFeeCents ?? n.feeCents) : 0, deliveryStatus: n ? (o.deliveryStatus ?? 'waiting') : null,
    });
  } else if (body.deliveryFeeCents != null) o.deliveryFeeCents = body.deliveryFeeCents;
  if (body.notes !== undefined) o.notes = body.notes || null;
  if (body.etaMinutes) o.etaAt = new Date(Date.now() + body.etaMinutes * 60000).toISOString();
  recalc(o);
  o.version++;
  event(o, 'updated', x, { notes: body.notes }, by);
  publish({ type: 'order.changed', orderId: o.id });
  return orderView(o);
});
route('POST', '/api/orders/:id/items', ({ a, params, body }) => {
  const x = a();
  need(x, 'orders.edit');
  const o = findOrder(params.id);
  checkVersion(o, body.version);
  requireEditable(o);
  const items = resolveItems(body.items);
  o.items.push(...items);
  recalc(o);
  o.version++;
  event(o, 'items.added', x, { items: summary(items) });
  if (body.send !== false && o.status === 'open') {
    if (o.stage === 'delivered') o.stage = 'ready';
    launch(o, x);
  }
  publish({ type: 'order.changed', orderId: o.id });
  publish({ type: 'kitchen.changed', orderId: o.id });
  return orderView(o);
});
route('POST', '/api/orders/:id/send', ({ a, params, body }) => {
  const x = a();
  const o = findOrder(params.id);
  checkVersion(o, body.version);
  launch(o, x);
  o.version++;
  publish({ type: 'kitchen.changed', orderId: o.id });
  return orderView(o);
});
route('PATCH', '/api/orders/:id/items/:itemId', ({ a, params, body }) => {
  const x = a();
  const o = findOrder(params.id);
  checkVersion(o, body.version);
  requireEditable(o);
  const it = o.items.find((i: Any) => i.id === params.itemId);
  if (!it || it.sentAt) throw err(409, 'conflict', 'Item já enviado à cozinha: cancele o item e lance novamente');
  if (body.quantity) {
    it.quantity = body.quantity;
    it.totalCents = (it.unitPriceCents + it.optionsUnitCents) * it.quantity;
  }
  recalc(o);
  o.version++;
  event(o, 'item.updated', x, { item: it.productName });
  return orderView(o);
});
route('POST', '/api/orders/:id/items/:itemId/cancel', ({ a, params, body }) => {
  const x = a();
  need(x, 'orders.edit');
  const o = findOrder(params.id);
  const it = o.items.find((i: Any) => i.id === params.itemId);
  if (!it) throw err(404, 'not_found', 'Item não encontrado');
  const by = it.sentAt ? authorize(x, 'orders.cancel_item_sent', body.supervisor) : null;
  checkVersion(o, body.version);
  requireEditable(o);
  if (it.status !== 'active') throw err(409, 'conflict', 'Item já cancelado');
  it.status = 'cancelled';
  it.cancelReason = body.reason;
  let mode: Any = null;
  if (it.stockDeducted) {
    const t = o.tickets.find((tt: Any) => tt.id === it.ticketId);
    mode = t && t.status !== 'received' ? 'loss' : 'return';
    reverseItem(it, mode, x, 'Cancelamento de item: ' + body.reason);
  }
  const t = o.tickets.find((tt: Any) => tt.id === it.ticketId);
  if (t) Object.assign(t, { changedAt: nowIso(), changeNote: `CANCELADO: ${it.quantity}x ${it.productName}` });
  recalc(o);
  o.version++;
  event(o, 'item.cancelled', x, { item: `${it.quantity}x ${it.productName}`, reason: body.reason, stock: mode }, by);
  refreshStage(o);
  publish({ type: 'order.changed', orderId: o.id });
  publish({ type: 'kitchen.changed', orderId: o.id });
  return orderView(o);
});
route('PUT', '/api/orders/:id/discount', ({ a, params, body }) => {
  const x = a();
  need(x, 'orders.edit');
  const o = findOrder(params.id);
  const by = discountOk(x, o.subtotalCents, body.discount, body.supervisor);
  checkVersion(o, body.version);
  requireEditable(o);
  Object.assign(o, { discountType: body.discount?.type ?? null, discountValue: body.discount?.value ?? null, discountReason: body.discount?.reason ?? null });
  recalc(o);
  o.version++;
  event(o, body.discount ? 'discount.set' : 'discount.removed', x, body.discount ? { ...body.discount, cents: o.discountCents } : {}, by);
  audit(x, 'order.discount', 'order', o.id, { number: o.number, cents: o.discountCents }, by);
  publish({ type: 'order.changed', orderId: o.id });
  return orderView(o);
});
route('POST', '/api/orders/:id/accept', ({ a, params, body }) => {
  const x = a();
  need(x, 'orders.edit');
  const o = findOrder(params.id);
  checkVersion(o, body.version);
  if (o.status !== 'pending') throw err(409, 'conflict', 'Este pedido não está aguardando aceite');
  Object.assign(o, { status: 'open', acceptedAt: nowIso(), etaAt: body.etaMinutes ? new Date(Date.now() + body.etaMinutes * 60000).toISOString() : o.etaAt });
  o.version++;
  event(o, 'accepted', x, { etaMinutes: body.etaMinutes });
  launch(o, x);
  notify(o, 'order_accepted');
  publish({ type: 'order.changed', orderId: o.id });
  publish({ type: 'kitchen.changed', orderId: o.id });
  return orderView(o);
});
route('POST', '/api/orders/:id/payments', ({ a, params, body, idem }) => {
  const x = a();
  need(x, 'payments.create');
  if (body.method === 'pix_integrated') throw err(422, 'not_configured', 'Pix integrado não está configurado. Registre como Pix conferido manualmente após verificar o recebimento no extrato.');
  return idempotent(idem, 'pay:' + params.id, body, () => {
    const cash = requireCash();
    const o = findOrder(params.id);
    if (o.status === 'cancelled') throw err(409, 'conflict', 'Pedido cancelado');
    if (o.status === 'pending') throw err(409, 'conflict', 'Aceite o pedido antes de registrar pagamento');
    if (o.status === 'closed' && !o.receivable) throw err(409, 'conflict', 'Pedido já finalizado');
    const balance = o.totalCents - o.paidCents;
    if (balance <= 0) throw err(409, 'conflict', 'Pedido já está quitado');
    if (!body.amountCents || body.amountCents > balance) throw err(422, 'unprocessable', 'Valor maior que o saldo do pedido');
    let applied = body.amountCents, change = 0, tendered: number | null = null;
    if (body.method === 'cash') {
      tendered = body.tenderedCents ?? body.amountCents;
      const r = cashPayment(balance, tendered!, body.amountCents);
      applied = r.appliedCents;
      change = r.changeCents;
    }
    const p = { id: uid(), method: body.method, amountCents: applied, tenderedCents: tendered, changeCents: change, status: 'confirmed', payerLabel: body.payerLabel || null, createdAt: nowIso(), createdBy: x.id, refundReason: null };
    o.payments.push(p);
    o.paidCents += applied;
    S.cashMoves.unshift({ id: uid(), cashSessionId: cash.id, type: 'payment', method: body.method, amountCents: applied, reason: `Pedido #${o.number}`, orderId: o.id, paymentId: p.id, createdBy: x.id, createdAt: nowIso() });
    event(o, 'payment', x, { method: body.method, amountCents: applied, tenderedCents: tendered, changeCents: change, payer: p.payerLabel });
    publish({ type: 'order.changed', orderId: o.id });
    publish({ type: 'cash.changed' });
    return { result: { paymentId: p.id, appliedCents: applied, changeCents: change, balanceCents: balance - applied }, order: orderView(o) };
  });
});
route('POST', '/api/payments/:id/refund', ({ a, params, body }) => {
  const x = a();
  const by = authorize(x, 'payments.refund', body.supervisor);
  const o = S.orders.find((y) => y.payments.some((p: Any) => p.id === params.id));
  if (!o) throw err(404, 'not_found', 'Pagamento não encontrado');
  if (o.status === 'closed') throw err(409, 'conflict', 'Reabra o pedido antes de estornar');
  const p = o.payments.find((y: Any) => y.id === params.id);
  refund(o, p, x, body.reason, by);
  event(o, 'payment.refunded', x, { amountCents: p.amountCents, reason: body.reason }, by);
  publish({ type: 'cash.changed' });
  return orderView(o);
});
route('GET', '/api/orders/:id/split', ({ params, query }) => {
  const o = findOrder(params.id);
  const bal = o.totalCents - o.paidCents;
  return { balanceCents: bal, parts: bal > 0 ? splitEvenly(bal, Number(query.get('ways'))) : [] };
});
route('POST', '/api/orders/:id/cancel', ({ a, params, body }) => {
  const x = a();
  const o = findOrder(params.id);
  const by = o.status === 'pending' ? (need(x, 'orders.edit'), null) : authorize(x, 'orders.cancel', body.supervisor);
  checkVersion(o, body.version);
  if (o.status === 'cancelled') throw err(409, 'conflict', 'Pedido já cancelado');
  if (o.status === 'closed') throw err(409, 'conflict', 'Reabra o pedido antes de cancelar');
  if (o.deliveryStatus === 'en_route') throw err(409, 'conflict', 'Pedido está em rota. Registre a ocorrência e o retorno antes de cancelar.');
  const conf = o.payments.filter((p: Any) => p.status === 'confirmed');
  if (conf.length && !body.refundPayments) throw err(409, 'payments_exist', 'Este pedido tem pagamentos. Confirme o estorno para cancelar.');
  for (const p of conf) refund(o, p, x, 'Cancelamento do pedido: ' + body.reason, by);
  for (const it of o.items.filter((i: Any) => i.status === 'active' && i.stockDeducted)) {
    const t = o.tickets.find((tt: Any) => tt.id === it.ticketId);
    reverseItem(it, t && t.status !== 'received' ? 'loss' : 'return', x, 'Cancelamento do pedido: ' + body.reason);
  }
  Object.assign(o, { status: 'cancelled', cancelledAt: nowIso(), cancelledBy: x.id, cancelReason: body.reason, courierId: null, deliveryRunId: null });
  for (const t of o.tickets) Object.assign(t, { changedAt: nowIso(), changeNote: 'PEDIDO CANCELADO' });
  o.version++;
  event(o, 'cancelled', x, { reason: body.reason, refunded: conf.length }, by);
  audit(x, 'order.cancel', 'order', o.id, { number: o.number, reason: body.reason }, by);
  notify(o, 'order_cancelled');
  publish({ type: 'order.changed', orderId: o.id });
  publish({ type: 'kitchen.changed', orderId: o.id });
  publish({ type: 'cash.changed' });
  return orderView(o);
});
route('POST', '/api/orders/:id/handover', ({ a, params }) => {
  const x = a();
  const o = findOrder(params.id);
  if (o.stage !== 'ready') throw err(409, 'conflict', 'O pedido ainda não está pronto');
  Object.assign(o, { stage: 'delivered', deliveredAt: nowIso() });
  event(o, 'handed_over', x);
  publish({ type: 'order.changed', orderId: o.id });
  return orderView(o);
});
route('POST', '/api/orders/:id/close', ({ a, params, body }) => {
  const x = a();
  need(x, 'orders.edit');
  const by = body.receivable ? authorize(x, 'orders.close_receivable', body.supervisor) : null;
  const o = findOrder(params.id);
  checkVersion(o, body.version);
  if (o.status !== 'open') throw err(409, 'conflict', 'Somente pedidos em aberto podem ser finalizados');
  const bal = o.totalCents - o.paidCents;
  if (bal > 0 && !body.receivable) throw err(422, 'balance_due', 'Ainda há saldo a receber neste pedido', { balanceCents: bal });
  if (o.items.some((i: Any) => i.status === 'active' && !i.sentAt)) throw err(409, 'conflict', 'Há itens lançados que ainda não foram enviados');
  if (o.type === 'delivery' ? o.deliveryStatus !== 'delivered' : !['ready', 'delivered'].includes(o.stage)) {
    throw err(409, 'conflict', o.type === 'delivery' ? 'Delivery só pode ser finalizado após a entrega' : 'O pedido ainda está em produção');
  }
  Object.assign(o, { status: 'closed', closedAt: nowIso(), receivable: bal > 0, stage: 'delivered', deliveredAt: o.deliveredAt ?? nowIso() });
  o.version++;
  event(o, 'closed', x, { receivableCents: bal > 0 ? bal : undefined }, by);
  publish({ type: 'order.changed', orderId: o.id });
  return orderView(o);
});
route('POST', '/api/orders/:id/reopen', ({ a, params, body }) => {
  const x = a();
  const by = authorize(x, 'orders.reopen', body.supervisor);
  const o = findOrder(params.id);
  if (o.status !== 'closed') throw err(409, 'conflict', 'Somente pedidos finalizados podem ser reabertos');
  if (S.days.find((d) => d.id === o.businessDayId)?.status !== 'open') throw err(409, 'conflict', 'O dia operacional deste pedido já foi fechado; a reabertura não é permitida');
  Object.assign(o, { status: 'open', closedAt: null, receivable: false });
  o.version++;
  event(o, 'reopened', x, { reason: body.reason }, by);
  audit(x, 'order.reopen', 'order', o.id, { number: o.number, reason: body.reason }, by);
  publish({ type: 'order.changed', orderId: o.id });
  return orderView(o);
});

// --- cozinha
route('GET', '/api/kitchen', ({ a }) => {
  need(a(), 'kitchen.view');
  const recent = Date.now() - 20 * 60000;
  const tickets: Any[] = [];
  for (const o of S.orders)
    for (const t of o.tickets) {
      const show =
        (['open', 'closed'].includes(o.status) && t.status !== 'ready') ||
        (['open', 'closed'].includes(o.status) && t.status === 'ready' && new Date(t.readyAt).getTime() > recent) ||
        (o.status === 'cancelled' && new Date(o.cancelledAt).getTime() > recent);
      if (!show) continue;
      const items = o.items.filter((i: Any) => i.ticketId === t.id).map((i: Any) => ({ ...i, options: i.options.map((x: Any) => ({ name: x.optionName, group: x.groupName, quantity: x.quantity })) }));
      if (items.length) tickets.push({ ...t, orderId: o.id, orderNumber: o.number, orderType: o.type, orderStatus: o.status, tableLabel: o.tableLabel, customerName: o.customerName, orderNotes: o.notes, etaAt: o.etaAt, source: o.source, items });
    }
  tickets.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  return { lateMinutes: S.settings.kitchenLateMinutes, tickets };
});
route('POST', '/api/kitchen/tickets/:id/status', ({ a, params, body }) => {
  const x = a();
  need(x, 'kitchen.update');
  const o = S.orders.find((y) => y.tickets.some((t: Any) => t.id === params.id));
  if (!o) throw err(404, 'not_found', 'Ticket não encontrado');
  if (o.status === 'cancelled') throw err(409, 'conflict', 'Pedido cancelado');
  const t = o.tickets.find((y: Any) => y.id === params.id);
  const from = t.status;
  if (from !== body.status) {
    const ok: Record<string, string[]> = { received: ['preparing', 'ready'], preparing: ['ready', 'received'], ready: ['preparing'] };
    if (!ok[from]!.includes(body.status)) throw err(409, 'conflict', 'Mudança de status inválida');
    Object.assign(t, { status: body.status, startedAt: body.status === 'received' ? null : (t.startedAt ?? nowIso()), readyAt: body.status === 'ready' ? nowIso() : null });
    event(o, 'kitchen', x, { round: t.round, from, to: body.status });
    refreshStage(o);
  }
  publish({ type: 'kitchen.changed', orderId: o.id });
  publish({ type: 'order.changed', orderId: o.id });
  return { id: t.id, status: t.status };
});

// --- entregas
function courierOfUser(userId: string) {
  return S.couriers.find((c) => c.userId === userId) ?? null;
}
function canActOn(x: Actor, courierId: string | null) {
  if (can(x.role, 'deliveries.manage')) return;
  need(x, 'deliveries.own');
  if (courierOfUser(x.id)?.id !== courierId) throw err(403, 'forbidden', 'Esta entrega não está atribuída a você');
}
function finishRun(runId: string | null) {
  if (!runId) return;
  if (!S.orders.some((o) => o.deliveryRunId === runId && ['waiting', 'en_route', 'issue'].includes(o.deliveryStatus))) {
    const r = S.runs.find((y) => y.id === runId);
    if (r && r.status !== 'finished') Object.assign(r, { status: 'finished', finishedAt: nowIso() });
  }
}
route('GET', '/api/couriers', ({ a, query }) => {
  need(a(), 'deliveries.manage');
  return S.couriers.filter((c) => query.get('all') === '1' || c.active);
});
route('POST', '/api/couriers', ({ a, body }) => {
  need(a(), 'settings.manage');
  let c = S.couriers.find((y) => y.id === body.id);
  if (!c) S.couriers.push((c = { id: uid() }));
  Object.assign(c, { name: body.name, phone: body.phone ? normalizePhoneBR(body.phone) : null, userId: body.userId ?? null, defaultFeeCents: body.defaultFeeCents, active: body.active ?? true });
  return c;
});
route('GET', '/api/deliveries', ({ a }) => {
  need(a(), 'deliveries.manage');
  const d = requireDay();
  const orders = S.orders
    .filter((o) => o.businessDayId === d.id && o.type === 'delivery' && !['cancelled', 'pending'].includes(o.status))
    .map((o) => ({ ...orderRow(o), addrComplement: o.addrComplement, addrReference: o.addrReference, deliveryFeeCents: o.deliveryFeeCents, courierFeeCents: o.courierFeeCents, paymentIntent: o.paymentIntent, changeForCents: o.changeForCents, deliveryIssue: o.deliveryIssue, courierId: o.courierId, deliveryRunId: o.deliveryRunId, readyAt: o.readyAt, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, notes: o.notes }));
  const runs = S.runs.filter((r) => r.businessDayId === d.id && r.status !== 'finished').map((r) => ({ ...r, courierName: S.couriers.find((c) => c.id === r.courierId)?.name }));
  return { orders, runs };
});
route('POST', '/api/deliveries/assign', ({ a, body }) => {
  const x = a();
  need(x, 'deliveries.manage');
  const d = requireDay();
  const list = body.orderIds.map(findOrder);
  for (const o of list) if (o.type !== 'delivery' || o.deliveryStatus !== 'waiting') throw err(409, 'conflict', `Pedido #${o.number} não pode ser atribuído`);
  const c = S.couriers.find((y) => y.id === body.courierId);
  if (!c) throw err(422, 'unprocessable', 'Entregador inativo ou inexistente');
  const run = { id: uid(), businessDayId: d.id, courierId: c.id, status: 'assigned', createdAt: nowIso(), departedAt: null, finishedAt: null };
  S.runs.push(run);
  for (const o of list) {
    const prev = o.deliveryRunId;
    const fee = S.neighborhoods.find((n) => n.id === o.neighborhoodId)?.courierFeeCents ?? c.defaultFeeCents;
    Object.assign(o, { courierId: c.id, deliveryRunId: run.id, courierFeeCents: fee });
    event(o, 'delivery.assigned', x);
    finishRun(prev);
  }
  publish({ type: 'delivery.changed' });
  return run;
});
route('POST', '/api/deliveries/:id/unassign', ({ a, params }) => {
  const x = a();
  need(x, 'deliveries.manage');
  const o = findOrder(params.id);
  if (o.deliveryStatus !== 'waiting') throw err(409, 'conflict', 'Pedido já saiu para entrega');
  const prev = o.deliveryRunId;
  Object.assign(o, { courierId: null, deliveryRunId: null, courierFeeCents: null });
  event(o, 'delivery.unassigned', x);
  finishRun(prev);
  publish({ type: 'delivery.changed' });
  return { id: o.id };
});
route('POST', '/api/deliveries/runs/:id/depart', ({ a, params }) => {
  const x = a();
  const r = S.runs.find((y) => y.id === params.id);
  if (!r) throw err(404, 'not_found', 'Saída não encontrada');
  canActOn(x, r.courierId);
  if (r.status !== 'assigned') throw err(409, 'conflict', 'Esta saída já foi iniciada');
  const list = S.orders.filter((o) => o.deliveryRunId === r.id && o.deliveryStatus === 'waiting');
  const nr = list.filter((o) => o.stage !== 'ready');
  if (nr.length) throw err(409, 'not_ready', `Pedido(s) ainda em produção: ${nr.map((o) => '#' + o.number).join(', ')}`);
  for (const o of list) {
    Object.assign(o, { deliveryStatus: 'en_route', stage: 'out_for_delivery', dispatchedAt: nowIso() });
    event(o, 'delivery.departed', x);
    notify(o, 'order_dispatched');
  }
  Object.assign(r, { status: 'en_route', departedAt: nowIso() });
  publish({ type: 'delivery.changed' });
  publish({ type: 'order.changed' });
  return { id: r.id };
});
route('POST', '/api/deliveries/:id/status', ({ a, params, body }) => {
  const x = a();
  const o = findOrder(params.id);
  canActOn(x, o.courierId);
  const from = o.deliveryStatus ?? 'waiting';
  const ok: Record<string, string[]> = { waiting: ['en_route'], en_route: ['delivered', 'issue'], issue: ['en_route', 'delivered', 'waiting'], delivered: [] };
  if (!ok[from]!.includes(body.status)) throw err(409, 'conflict', 'Mudança de status de entrega inválida');
  if (body.status === 'issue' && !body.note?.trim()) throw err(422, 'unprocessable', 'Descreva a ocorrência');
  o.deliveryStatus = body.status;
  if (body.status === 'delivered') Object.assign(o, { stage: 'delivered', deliveredAt: nowIso() });
  if (body.status === 'issue') o.deliveryIssue = body.note;
  if (body.status === 'en_route') o.stage = 'out_for_delivery';
  if (body.status === 'waiting') {
    need(x, 'deliveries.manage');
    Object.assign(o, { stage: 'ready', courierId: null, deliveryRunId: null, courierFeeCents: null, dispatchedAt: null });
  }
  event(o, 'delivery.' + body.status, x, body.note ? { note: body.note } : undefined);
  if (['delivered', 'waiting'].includes(body.status)) finishRun(o.deliveryRunId);
  publish({ type: 'delivery.changed' });
  publish({ type: 'order.changed', orderId: o.id });
  return { id: o.id, deliveryStatus: o.deliveryStatus };
});
route('GET', '/api/courier/me', ({ a }) => {
  const x = a();
  need(x, 'deliveries.own');
  const c = courierOfUser(x.id);
  if (!c) return { courier: null, runs: [], deliveries: [] };
  const d = openDay();
  if (!d) return { courier: { id: c.id, name: c.name }, runs: [], deliveries: [] };
  const deliveries = S.orders
    .filter((o) => o.courierId === c.id && o.businessDayId === d.id && o.status !== 'cancelled')
    .map((o) => ({
      id: o.id, number: o.number, customerName: o.customerName, customerPhone: o.customerPhone, addrStreet: o.addrStreet, addrNumber: o.addrNumber, addrComplement: o.addrComplement,
      addrReference: o.addrReference, neighborhoodName: o.neighborhoodName, totalCents: o.totalCents, paidCents: o.paidCents, paymentIntent: o.paymentIntent, changeForCents: o.changeForCents,
      notes: o.notes, deliveryStatus: o.deliveryStatus, deliveryIssue: o.deliveryIssue, deliveryRunId: o.deliveryRunId, courierFeeCents: o.courierFeeCents, stage: o.stage,
      dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, itemCount: o.items.filter((i: Any) => i.status === 'active').reduce((s: number, i: Any) => s + i.quantity, 0), balanceCents: o.totalCents - o.paidCents,
    }));
  return { courier: { id: c.id, name: c.name }, runs: S.runs.filter((r) => r.courierId === c.id && r.businessDayId === d.id).reverse(), deliveries };
});
function pendingOf(cid: string) {
  const deliveries = S.orders.filter((o) => o.courierId === cid && o.deliveryStatus === 'delivered' && !o.courierSettlementId && o.status !== 'cancelled').map((o) => ({ id: o.id, number: o.number, fee: o.courierFeeCents, deliveredAt: o.deliveredAt, neighborhoodName: o.neighborhoodName }));
  const adjustments = S.adjustments.filter((x) => x.courierId === cid && !x.settlementId);
  const fees = deliveries.reduce((s, d) => s + (d.fee ?? 0), 0);
  const adj = adjustments.reduce((s, x) => s + (x.type === 'bonus' ? x.amountCents : -x.amountCents), 0);
  return { deliveries, adjustments, deliveriesCount: deliveries.length, feesCents: fees, adjustmentsCents: adj, totalCents: fees + adj };
}
route('GET', '/api/couriers/:id/pending', ({ a, params }) => {
  need(a(), 'couriers.settle');
  return pendingOf(params.id!);
});
route('POST', '/api/couriers/:id/adjustments', ({ a, params, body }) => {
  const x = a();
  need(x, 'couriers.settle');
  const r = { id: uid(), courierId: params.id, type: body.type, amountCents: body.amountCents, reason: body.reason, settlementId: null, createdAt: nowIso() };
  S.adjustments.push(r);
  publish({ type: 'delivery.changed' });
  return r;
});
route('POST', '/api/couriers/:id/settle', ({ a, params, body, idem }) => {
  const x = a();
  need(x, 'couriers.settle');
  return idempotent(idem, 'settle:' + params.id, body, () => {
    const p = pendingOf(params.id!);
    if (!p.deliveriesCount && !p.adjustments.length) throw err(409, 'conflict', 'Nada pendente para acerto');
    if (p.totalCents !== body.expectedTotalCents) throw err(409, 'settlement_changed', 'Os valores pendentes mudaram. Revise antes de confirmar.');
    if (body.paidFromCash && p.totalCents > 0) {
      const cash = requireCash();
      if (cashBalance(cash.id) < p.totalCents) throw err(422, 'insufficient_cash', 'Dinheiro em caixa insuficiente para o repasse');
      S.cashMoves.unshift({ id: uid(), cashSessionId: cash.id, type: 'courier_payout', method: 'cash', amountCents: -p.totalCents, reason: 'Acerto entregador', createdBy: x.id, createdAt: nowIso() });
    }
    const s = { id: uid(), courierId: params.id, deliveriesCount: p.deliveriesCount, deliveryFeesCents: p.feesCents, adjustmentsCents: p.adjustmentsCents, totalCents: p.totalCents, paidFromCash: body.paidFromCash, createdAt: nowIso() };
    S.settlements.unshift(s);
    for (const d of p.deliveries) findOrder(d.id).courierSettlementId = s.id;
    for (const adj of p.adjustments) adj.settlementId = s.id;
    publish({ type: 'cash.changed' });
    return { settlementId: s.id, totalCents: s.totalCents };
  });
});
route('GET', '/api/settlements', () => S.settlements.map((s) => ({ ...s, courierName: S.couriers.find((c) => c.id === s.courierId)?.name })));

// --- configurações, usuários, bairros, clientes, despesas, auditoria
route('GET', '/api/settings', ({ a }) => (a(), S.settings));
route('PUT', '/api/settings', ({ a, body }) => {
  const x = a();
  need(x, 'settings.manage');
  Object.assign(S.settings, body);
  audit(x, 'settings.update', 'settings', 'store', body);
  publish({ type: 'menu.changed' });
  return S.settings;
});
route('GET', '/api/users', ({ a }) => {
  need(a(), 'users.manage');
  return S.users.map(({ password: _p, ...u }) => u);
});
route('POST', '/api/users', ({ a, body }) => {
  const x = a();
  need(x, 'users.manage');
  if (S.users.some((u) => u.username === body.username && u.id !== body.id)) throw err(409, 'conflict', 'Nome de usuário já existe');
  let u = S.users.find((y) => y.id === body.id);
  if (!u) {
    if (!body.password || body.password.length < 8) throw err(422, 'unprocessable', 'A senha precisa ter pelo menos 8 caracteres');
    S.users.push((u = { id: uid(), lastLoginAt: null } as User));
  }
  Object.assign(u, { name: body.name, username: body.username, role: body.role, active: body.active ?? true, ...(body.password ? { password: body.password } : {}) });
  if (!S.users.some((y) => y.role === 'admin' && y.active)) throw err(409, 'conflict', 'O sistema precisa de pelo menos um administrador ativo');
  return { id: u.id };
});
route('GET', '/api/neighborhoods', ({ a }) => (a(), S.neighborhoods));
route('POST', '/api/neighborhoods', ({ a, body }) => {
  need(a(), 'settings.manage');
  let n = S.neighborhoods.find((y) => y.id === body.id);
  if (!n) S.neighborhoods.push((n = { id: uid() }));
  Object.assign(n, { name: body.name, feeCents: body.feeCents, courierFeeCents: body.courierFeeCents ?? null, minOrderCents: body.minOrderCents ?? 0, etaMinutes: body.etaMinutes ?? 45, active: body.active ?? true });
  return n;
});
function customerView(c: Any) {
  const history = S.orders.filter((o) => o.customerId === c.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((o) => ({ id: o.id, number: o.number, type: o.type, status: o.status, totalCents: o.totalCents, createdAt: o.createdAt }));
  return { ...c, history, whatsapp: S.waContacts.find((w) => w.customerId === c.id) ?? null };
}
route('GET', '/api/customers', ({ a, query }) => {
  need(a(), 'customers.view');
  const phone = query.get('phone');
  if (phone) {
    const p = normalizePhoneBR(phone);
    const c = p ? S.customers.find((x) => x.phone === p) : null;
    return c ? customerView(c) : null;
  }
  const q = (query.get('q') ?? '').trim().toLowerCase();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, '');
  return S.customers
    .filter((c) => !c.anonymizedAt && (c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phone?.includes(digits))))
    .map((c) => {
      const os = S.orders.filter((o) => o.customerId === c.id);
      return { id: c.id, name: c.name, phone: c.phone, notes: c.notes, orders: os.filter((o) => o.status !== 'cancelled').length, lastOrderAt: os.at(-1)?.createdAt ?? null };
    });
});
route('GET', '/api/customers/:id', ({ a, params }) => {
  need(a(), 'customers.view');
  const c = S.customers.find((x) => x.id === params.id);
  if (!c) throw err(404, 'not_found', 'Cliente não encontrado');
  return customerView(c);
});
route('PATCH', '/api/customers/:id', ({ a, params, body }) => {
  need(a(), 'customers.manage');
  const c = S.customers.find((x) => x.id === params.id);
  if (body.name !== undefined) c.name = body.name;
  if (body.phone !== undefined) c.phone = body.phone ? normalizePhoneBR(body.phone) : null;
  if (body.notes !== undefined) c.notes = body.notes;
  return c;
});
route('DELETE', '/api/customers/:id/addresses/:addressId', ({ a, params }) => {
  need(a(), 'customers.manage');
  const c = S.customers.find((x) => x.id === params.id);
  c.addresses = c.addresses.filter((x: Any) => x.id !== params.addressId);
  return { ok: true };
});
route('POST', '/api/customers/:id/anonymize', ({ a, params, body }) => {
  const x = a();
  need(x, 'customers.erase');
  const c = S.customers.find((y) => y.id === params.id);
  if (S.orders.some((o) => o.customerId === c.id && ['pending', 'open'].includes(o.status))) throw err(409, 'conflict', 'Cliente tem pedidos em aberto');
  for (const o of S.orders.filter((y) => y.customerId === c.id)) Object.assign(o, { customerName: 'Cliente removido', customerPhone: null, addrStreet: null, addrNumber: null, addrComplement: null, addrReference: null, trackingToken: null });
  const w = S.waContacts.filter((y) => y.customerId === c.id).map((y) => y.id);
  S.waMessages = S.waMessages.filter((m) => !w.includes(m.contactId));
  S.waContacts = S.waContacts.filter((y) => !w.includes(y.id));
  Object.assign(c, { name: 'Cliente removido', phone: null, notes: null, addresses: [], anonymizedAt: nowIso() });
  audit(x, 'customer.anonymize', 'customer', c.id, { reason: body.reason });
  return { id: c.id };
});
route('GET', '/api/expenses', ({ a, query }) => {
  need(a(), 'expenses.manage');
  return S.expenses.filter((e) => !e.deletedAt && e.date >= query.get('from')! && e.date <= query.get('to')!).sort((x, y) => y.date.localeCompare(x.date));
});
route('POST', '/api/expenses', ({ a, body }) => {
  const x = a();
  need(x, 'expenses.manage');
  if (body.paidFromCash) {
    const cash = requireCash();
    if (cashBalance(cash.id) < body.amountCents) throw err(422, 'insufficient_cash', 'Dinheiro em caixa insuficiente');
    S.cashMoves.unshift({ id: uid(), cashSessionId: cash.id, type: 'expense', method: 'cash', amountCents: -body.amountCents, reason: body.description, createdBy: x.id, createdAt: nowIso() });
  }
  const e = { id: uid(), date: body.date ?? localDateISO(new Date()), category: body.category, description: body.description, amountCents: body.amountCents, paidFromCash: body.paidFromCash, createdAt: nowIso(), deletedAt: null };
  S.expenses.push(e);
  return e;
});
route('DELETE', '/api/expenses/:id', ({ a, params }) => {
  need(a(), 'expenses.manage');
  const e = S.expenses.find((x) => x.id === params.id);
  if (e?.paidFromCash) throw err(409, 'conflict', 'Despesa paga pelo caixa não pode ser excluída; registre um suprimento para corrigir');
  if (e) e.deletedAt = nowIso();
  return { ok: true };
});
route('GET', '/api/audit', ({ a, query }) => {
  need(a(), 'audit.view');
  return S.audit.filter((x) => !query.get('entity') || x.entity === query.get('entity')).map((x) => ({ ...x, userName: userName(x.userId), authorizedByName: userName(x.authorizedBy) }));
});

// --- relatórios (mesmos conceitos do servidor real)
route('GET', '/api/reports/sales', ({ a, query }) => {
  need(a(), 'reports.view');
  const from = query.get('from')!, to = query.get('to')!;
  const dayIds = new Set(S.days.filter((d) => d.referenceDate >= from && d.referenceDate <= to).map((d) => d.id));
  const os = S.orders.filter((o) => dayIds.has(o.businessDayId));
  const sold = os.filter((o) => !['cancelled', 'pending'].includes(o.status));
  const sum = (xs: Any[], f: (x: Any) => number) => xs.reduce((s, x) => s + f(x), 0);
  const gross = sum(sold, (o) => o.subtotalCents), disc = sum(sold, (o) => o.discountCents), fees = sum(sold, (o) => o.deliveryFeeCents);
  const net = gross - disc;
  const cancelled = os.filter((o) => o.status === 'cancelled');
  const sessions = new Set(S.cashSessions.filter((c) => dayIds.has(c.businessDayId)).map((c) => c.id));
  const pays: Record<string, Any> = {};
  for (const o of S.orders) for (const p of o.payments) {
    const mv = S.cashMoves.find((m) => m.paymentId === p.id && m.type === 'payment');
    if (!mv || !sessions.has(mv.cashSessionId)) continue;
    const t = (pays[p.method] ??= { method: p.method, received: 0, refunded: 0, count: 0 });
    t.received += p.amountCents;
    t.count++;
    if (p.status === 'refunded') t.refunded += p.amountCents;
  }
  const itemsMap = new Map<string, Any>();
  for (const o of sold) for (const i of o.items.filter((x: Any) => x.status === 'active')) {
    const k = i.productName + '|' + (i.variantName ?? '');
    const t = itemsMap.get(k) ?? { product: i.productName, variant: i.variantName, category: i.categoryName, qty: 0, revenue: 0, cost: 0, missing_cost: 0 };
    t.qty += i.quantity;
    t.revenue += i.totalCents;
    if (i.unitCostCents == null) t.missing_cost++;
    else t.cost += i.unitCostCents * i.quantity;
    itemsMap.set(k, t);
  }
  const items = [...itemsMap.values()].sort((x, y) => y.qty - x.qty);
  const group = (key: (o: Any) => Any, f: (xs: Any[]) => Any) => {
    const m = new Map<Any, Any[]>();
    for (const o of sold) m.set(key(o), [...(m.get(key(o)) ?? []), o]);
    return [...m.entries()].map(([k, xs]) => f([k, xs]));
  };
  const cats = new Map<string, Any>();
  for (const i of items) {
    const c = cats.get(i.category) ?? { category: i.category, qty: 0, revenue: 0 };
    c.qty += i.qty;
    c.revenue += i.revenue;
    cats.set(i.category, c);
  }
  const deliveries = os.filter((o) => o.courierId && o.status !== 'cancelled');
  const couriers = S.couriers
    .map((c) => {
      const mine = deliveries.filter((o) => o.courierId === c.id);
      const done = mine.filter((o) => o.deliveryStatus === 'delivered');
      const times = done.filter((o) => o.dispatchedAt).map((o) => (new Date(o.deliveredAt).getTime() - new Date(o.dispatchedAt).getTime()) / 60000);
      return { courier: c.name, deliveries: done.length, fees_owed: sum(done, (o) => o.courierFeeCents ?? 0), avg_minutes: times.length ? Math.round(sum(times, (t) => t) / times.length) : null, issues: mine.filter((o) => o.deliveryStatus === 'issue').length };
    })
    .filter((c) => c.deliveries || c.issues);
  const prep = sold.flatMap((o) => o.tickets.filter((t: Any) => t.readyAt).map((t: Any) => (new Date(t.readyAt).getTime() - new Date(t.createdAt).getTime()) / 60000));
  const exp = sum(S.expenses.filter((e) => !e.deletedAt && e.date >= from && e.date <= to), (e) => e.amountCents);
  const cogs = sum(items, (i) => i.cost);
  const missing = items.filter((i) => i.missing_cost).map((i) => i.product);
  const courierFees = sum(couriers, (c) => c.fees_owed);
  const payments = Object.values(pays);
  return {
    range: { from, to },
    summary: {
      orders: sold.length, grossCents: gross, discountsCents: disc, netCents: net, deliveryFeesCents: fees, billedCents: net + fees,
      averageTicketCents: sold.length ? Math.round((net + fees) / sold.length) : 0, cancelledCount: cancelled.length, cancelledValueCents: sum(cancelled, (o) => o.totalCents),
      receivableOpenCents: sum(os.filter((o) => o.status === 'closed' && o.receivable), (o) => o.totalCents - o.paidCents), receivedNetCents: sum(payments, (p) => p.received - p.refunded),
    },
    margin: { netSalesCents: net, costOfGoodsCents: cogs, grossMarginCents: net - cogs, courierFeesCents: courierFees, deliveryFeesCents: fees, expensesCents: exp, estimatedResultCents: net + fees - cogs - courierFees - exp, complete: !missing.length, missingCost: missing },
    payments,
    items,
    byCategory: [...cats.values()],
    byType: group((o) => o.type, ([type, xs]) => ({ type, orders: xs.length, total: sum(xs, (o) => o.totalCents) })),
    byHour: group((o) => localHour(new Date(o.createdAt)), ([hour, xs]) => ({ hour, orders: xs.length, total: sum(xs, (o) => o.totalCents) })).sort((x, y) => x.hour - y.hour),
    byDay: S.days.filter((d) => dayIds.has(d.id)).map((d) => {
      const xs = sold.filter((o) => o.businessDayId === d.id);
      return { reference_date: d.referenceDate, orders: xs.length, net: sum(xs, (o) => o.subtotalCents - o.discountCents), fees: sum(xs, (o) => o.deliveryFeeCents) };
    }),
    byNeighborhood: group((o) => (o.type === 'delivery' ? o.neighborhoodName : null), ([neighborhood, xs]) => ({ neighborhood, orders: xs.length, fees: sum(xs, (o) => o.deliveryFeeCents), total: sum(xs, (o) => o.totalCents) })).filter((n) => n.neighborhood),
    couriers,
    times: { avgPrepMinutes: prep.length ? Math.round(sum(prep, (t) => t) / prep.length) : null, avgDeliveryMinutes: couriers.find((c) => c.avg_minutes != null)?.avg_minutes ?? null, avgOrderToDoorMinutes: null },
    lowStock: S.stock.filter((s) => s.quantity <= s.minQuantity).map((s) => ({ ...s, quantity: String(s.quantity), minQuantity: String(s.minQuantity) })),
  };
});

// --- WhatsApp
route('GET', '/api/whatsapp/status', () => ({ mode: 'demo', configured: false, webhookPath: '/api/webhooks/whatsapp', graphVersion: 'v23.0' }));
route('GET', '/api/whatsapp/conversations', ({ a, query }) => {
  need(a(), 'whatsapp.inbox');
  const q = query.get('q')?.toLowerCase() ?? '';
  return S.waContacts
    .map((c) => {
      const msgs = S.waMessages.filter((m) => m.contactId === c.id);
      return { ...c, customerName: S.customers.find((x) => x.id === c.customerId)?.name ?? null, lastBody: msgs.at(-1)?.body ?? null, failedCount: msgs.filter((m) => m.status === 'failed').length, windowOpen: windowOpen(c.lastInboundAt) };
    })
    .filter((c) => !q || [c.profileName, c.customerName, c.waId].some((v) => v?.toLowerCase().includes(q)))
    .sort((x, y) => Number(y.needsHuman) - Number(x.needsHuman) || (y.lastMessageAt ?? '').localeCompare(x.lastMessageAt ?? ''));
});
route('GET', '/api/whatsapp/conversations/:id', ({ a, params }) => {
  need(a(), 'whatsapp.inbox');
  const c = S.waContacts.find((x) => x.id === params.id);
  if (!c) throw err(404, 'not_found', 'Conversa não encontrada');
  c.unreadCount = 0;
  return {
    contact: { ...c, windowOpen: windowOpen(c.lastInboundAt) },
    customer: S.customers.find((x) => x.id === c.customerId) ?? null,
    messages: S.waMessages.filter((m) => m.contactId === c.id),
    orders: S.orders.filter((o) => phoneVariantsBR(c.waId).includes(o.customerPhone)).map((o) => ({ id: o.id, number: o.number, status: o.status, stage: o.stage, totalCents: o.totalCents, createdAt: o.createdAt, type: o.type })),
  };
});
route('POST', '/api/whatsapp/conversations/:id/messages', ({ a, params, body }) => {
  const x = a();
  need(x, 'whatsapp.inbox');
  const c = S.waContacts.find((y) => y.id === params.id);
  if (!windowOpen(c.lastInboundAt)) throw err(422, 'window_closed', 'A janela de 24h está fechada. Só é possível enviar um template aprovado até o cliente responder.');
  return { id: outMsg(c, body.body, { createdBy: x.id }).id };
});
route('POST', '/api/whatsapp/conversations/:id/menu-link', ({ a, params }) => {
  need(a(), 'whatsapp.inbox');
  const c = S.waContacts.find((y) => y.id === params.id);
  if (!windowOpen(c.lastInboundAt)) throw err(422, 'window_closed', 'A janela de 24h está fechada.');
  return { id: outMsg(c, 'Confira nosso cardápio e faça seu pedido pelo cardápio digital.').id };
});
route('PATCH', '/api/whatsapp/conversations/:id', ({ a, params, body }) => {
  const x = a();
  need(x, 'whatsapp.inbox');
  const c = S.waContacts.find((y) => y.id === params.id);
  for (const k of ['botPaused', 'needsHuman', 'optInOrderUpdates', 'optInMarketing']) if (body[k] !== undefined) c[k] = body[k];
  if (body.optInOrderUpdates || body.optInMarketing) Object.assign(c, { optInAt: nowIso(), optInSource: 'atendente:' + x.name, optOutAt: null });
  publish({ type: 'whatsapp.changed' });
  return { id: c.id };
});
route('POST', '/api/whatsapp/messages/:id/retry', ({ a, params }) => {
  need(a(), 'whatsapp.inbox');
  const m = S.waMessages.find((y) => y.id === params.id);
  if (!m || m.status !== 'failed') throw err(409, 'conflict', 'Somente mensagens com falha podem ser reenviadas');
  const c = S.waContacts.find((y) => y.id === m.contactId);
  if (!windowOpen(c.lastInboundAt) && !S.templates.some((t) => m.dedupeKey?.includes(t.purpose) && t.active)) {
    throw err(422, 'window_closed', 'Janela de 24h fechada e sem template aprovado para esta mensagem. Aguarde o cliente responder.');
  }
  Object.assign(m, { status: 'sent', error: null, type: windowOpen(c.lastInboundAt) ? 'text' : 'template' });
  publish({ type: 'whatsapp.changed' });
  return { id: m.id };
});
route('GET', '/api/whatsapp/monitor', () => {
  const failed = S.waMessages.filter((m) => m.status === 'failed');
  return {
    failedMessages: failed.map((m) => ({ ...m, waId: S.waContacts.find((c) => c.id === m.contactId)?.waId, profileName: S.waContacts.find((c) => c.id === m.contactId)?.profileName })),
    queue: [{ status: 'failed', count: failed.length }],
    events: [],
    failedEvents: [],
  };
});
route('GET', '/api/whatsapp/quick-replies', () => S.quickReplies);
route('POST', '/api/whatsapp/quick-replies', ({ a, body }) => {
  need(a(), 'settings.manage');
  let r = S.quickReplies.find((y) => y.id === body.id);
  if (!r) S.quickReplies.push((r = { id: uid(), sort: 0 }));
  Object.assign(r, { title: body.title, body: body.body });
  return r;
});
route('DELETE', '/api/whatsapp/quick-replies/:id', ({ params }) => {
  S.quickReplies = S.quickReplies.filter((r) => r.id !== params.id);
  return { ok: true };
});
route('GET', '/api/whatsapp/templates', () => S.templates);
route('POST', '/api/whatsapp/templates', ({ a, body }) => {
  need(a(), 'whatsapp.configure');
  S.templates = [...S.templates.filter((t) => t.purpose !== body.purpose), { id: uid(), ...body }];
  return body;
});
route('POST', '/api/whatsapp/demo/inbound', ({ a, body }) => {
  need(a(), 'whatsapp.inbox');
  const p = normalizePhoneBR(body.phone);
  if (!p) throw err(400, 'bad_phone', 'Telefone inválido');
  inbound(p, body.name ?? 'Cliente (demo)', body.text);
  publish({ type: 'whatsapp.changed' });
  return { ok: true };
});

// --- cardápio digital (público)
function storeStatus() {
  const d = openDay();
  const open = !!d && S.settings.onlineOrdersEnabled;
  return {
    name: S.settings.storeName, phone: S.settings.storePhone, address: S.settings.storeAddress, open,
    closedReason: !d ? 'A loja está fechada no momento.' : !S.settings.onlineOrdersEnabled ? 'Pedidos online pausados no momento.' : null,
    minOrderCents: S.settings.onlineMinOrderCents, pickupEtaMinutes: S.settings.pickupEtaMinutes, deliveryEtaMinutes: S.settings.deliveryEtaMinutes,
    paymentMethods: S.settings.onlinePaymentMethods, pixKeyDisplay: S.settings.pixKeyDisplay,
  };
}
route('GET', '/api/public/menu', () => ({
  store: storeStatus(),
  menu: menuView(true),
  neighborhoods: S.neighborhoods.filter((n) => n.active).map((n) => ({ id: n.id, name: n.name, feeCents: n.feeCents, minOrderCents: n.minOrderCents, etaMinutes: n.etaMinutes })),
}));
route('POST', '/api/public/orders', ({ body, idem }) => {
  if (!body.privacyAccepted) throw err(400, 'validation', 'Aceite o uso dos dados para concluir o pedido');
  const st = storeStatus();
  if (!st.open) throw err(409, 'store_closed', st.closedReason ?? 'Loja fechada');
  const { privacyAccepted: _p, ...input } = body;
  return idempotent(idem, 'public', input, () => {
    const o = createOrder(null, { ...input, confirmDuplicate: true, send: false }, 'online');
    return { number: o.number, trackingToken: o.trackingToken };
  });
});
route('GET', '/api/public/orders/:token', ({ params }) => {
  const o = S.orders.find((x) => x.trackingToken === params.token);
  if (!o) throw err(404, 'not_found', 'Pedido não encontrado');
  return {
    number: o.number, type: o.type, status: o.status, stage: o.stage, deliveryStatus: o.deliveryStatus, customerFirstName: o.customerName?.split(' ')[0] ?? null,
    neighborhoodName: o.neighborhoodName, createdAt: o.createdAt, acceptedAt: o.acceptedAt, readyAt: o.readyAt, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt,
    cancelledAt: o.cancelledAt, etaAt: o.etaAt, subtotalCents: o.subtotalCents, discountCents: o.discountCents, deliveryFeeCents: o.deliveryFeeCents, totalCents: o.totalCents,
    paidCents: o.paidCents, paymentIntent: o.paymentIntent, changeForCents: o.changeForCents,
    items: o.items.filter((i: Any) => i.status === 'active').map((i: Any) => ({ name: i.productName + (i.variantName ? ` (${i.variantName})` : ''), quantity: i.quantity, totalCents: i.totalCents, notes: i.notes, options: i.options.map((x: Any) => x.optionName) })),
    store: { name: S.settings.storeName, phone: S.settings.storePhone, pixKeyDisplay: S.settings.pixKeyDisplay },
  };
});

route('GET', '/api/reports/export', () => {
  throw err(422, 'demo', 'Exportação CSV não está disponível na demonstração (funciona no sistema instalado).');
});

// ---------------------------------------------------------------- instalação

function respond(status: number, body: Any) {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function handle(method: string, url: URL, init?: RequestInit): Promise<Response> {
  const path = url.pathname;
  for (const [m, re, names, h] of routes) {
    if (m !== method) continue;
    const match = re.exec(path);
    if (!match) continue;
    const params = {} as Params;
    names.forEach((n, i) => (params[n] = decodeURIComponent(match[i + 1]!)));
    let body: Any = {};
    if (typeof init?.body === 'string' && init.body) body = JSON.parse(init.body);
    const headers = new Headers(init?.headers);
    try {
      const out = h({ a: me, body, params, query: url.searchParams, idem: headers.get('idempotency-key') });
      save();
      // pequena latência para parecer uma rede real
      await new Promise((r) => setTimeout(r, 60));
      return respond(200, out ?? null);
    } catch (e) {
      save();
      if (e instanceof HttpError) return respond(e.status, { error: { code: e.code, message: e.message, details: e.details } });
      console.error(e);
      return respond(500, { error: { code: 'internal', message: 'Erro interno na demonstração: ' + (e as Error).message } });
    }
  }
  return respond(404, { error: { code: 'not_found', message: 'Função não disponível na demonstração' } });
}

export function installMockApi() {
  load();
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // a demonstração pode rodar num iframe sem origem http (ex.: about:srcdoc)
    const url = new URL(raw.startsWith('/') ? 'http://demo.local' + raw : raw);
    if (url.pathname.startsWith('/api/')) return handle((init?.method ?? 'GET').toUpperCase(), url, init);
    return realFetch(input, init);
  };
  (window as Any).EventSource = FakeEventSource;
}

export function loginAs(username: string) {
  const u = S.users.find((x) => x.username === username);
  sessionUserId = u?.id ?? null;
  saveSession();
}

export function currentUser() {
  return S.users.find((u) => u.id === sessionUserId)?.username ?? null;
}
