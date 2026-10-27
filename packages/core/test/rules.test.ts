import { describe, expect, it } from 'vitest';
import { can, ROLE_PERMISSIONS } from '../src/permissions.js';
import { canTransitionDelivery, canTransitionKitchen, canTransitionOrder, stageFromTickets } from '../src/status.js';
import { formatPhoneBR, localDateISO, localHour, normalizePhoneBR, phoneVariantsBR } from '../src/br.js';

describe('permissões', () => {
  it('perfis restritos', () => {
    expect(can('courier', 'orders.view')).toBe(false);
    expect(can('courier', 'deliveries.own')).toBe(true);
    expect(can('kitchen', 'reports.view')).toBe(false);
    expect(can('cashier', 'orders.cancel')).toBe(false);
    expect(can('cashier', 'cash.close')).toBe(false);
    expect(can('cashier', 'reports.view')).toBe(false);
    expect(can('manager', 'users.manage')).toBe(false);
    expect(can('admin', 'users.manage')).toBe(true);
    expect(ROLE_PERMISSIONS.admin.has('deliveries.own')).toBe(false);
  });
});

describe('máquinas de estado', () => {
  it('pedido', () => {
    expect(canTransitionOrder('pending', 'open')).toBe(true);
    expect(canTransitionOrder('cancelled', 'open')).toBe(false);
    expect(canTransitionOrder('closed', 'cancelled')).toBe(false);
  });
  it('cozinha e entrega', () => {
    expect(canTransitionKitchen('received', 'ready')).toBe(true);
    expect(canTransitionKitchen('ready', 'received')).toBe(false);
    expect(canTransitionDelivery('waiting', 'delivered')).toBe(false);
    expect(canTransitionDelivery('en_route', 'delivered')).toBe(true);
    expect(canTransitionDelivery('delivered', 'issue')).toBe(false);
  });
  it('etapa derivada dos tickets', () => {
    expect(stageFromTickets([])).toBe('ready');
    expect(stageFromTickets(['received', 'received'])).toBe('received');
    expect(stageFromTickets(['ready', 'received'])).toBe('preparing');
    expect(stageFromTickets(['ready', 'ready'])).toBe('ready');
  });
});

describe('Brasil', () => {
  it('telefones', () => {
    expect(normalizePhoneBR('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizePhoneBR('+55 11 98765-4321')).toBe('5511987654321');
    expect(normalizePhoneBR('1133334444')).toBe('551133334444');
    expect(normalizePhoneBR('123')).toBeNull();
    expect(formatPhoneBR('5511987654321')).toBe('(11) 98765-4321');
    expect(phoneVariantsBR('5511987654321')).toEqual(['5511987654321', '551187654321']);
  });
  it('fuso America/Sao_Paulo', () => {
    const d = new Date('2026-10-25T02:30:00Z'); // 23:30 do dia 24 em SP
    expect(localDateISO(d)).toBe('2026-10-24');
    expect(localHour(d)).toBe(23);
  });
});

describe('atendente', () => {
  it('permissões do perfil atendente', async () => {
    const { can } = await import('../src/permissions.js');
    expect(can('waiter', 'orders.create')).toBe(true);
    expect(can('waiter', 'tables.serve')).toBe(true);
    expect(can('waiter', 'payments.create')).toBe(false);
    expect(can('waiter', 'orders.close')).toBe(false);
    expect(can('waiter', 'orders.discount')).toBe(false);
    expect(can('waiter', 'orders.cancel')).toBe(false);
    expect(can('waiter', 'kitchen.view')).toBe(false);
    expect(can('cashier', 'orders.close')).toBe(true);
  });
  it('rótulo de mesa e comanda', async () => {
    const { placeLabel } = await import('../src/status.js');
    expect(placeLabel({ type: 'table', tabKind: 'table', tableLabel: '5' })).toBe('Mesa 5');
    expect(placeLabel({ type: 'table', tabKind: 'tab', tableLabel: '15' })).toBe('Comanda 15');
    expect(placeLabel({ type: 'delivery' })).toBe('Delivery');
  });
});
