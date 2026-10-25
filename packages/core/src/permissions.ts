export const ROLES = ['admin', 'manager', 'cashier', 'kitchen', 'courier'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  manager: 'Gerente',
  cashier: 'Caixa',
  kitchen: 'Cozinha',
  courier: 'Entregador',
};

export const PERMISSIONS = [
  'orders.view',
  'orders.create',
  'orders.edit',
  'orders.discount', // desconto até o limite do caixa
  'orders.discount.unlimited',
  'orders.cancel',
  'orders.cancel_item_sent', // cancelar item já enviado à cozinha
  'orders.reopen',
  'orders.close_receivable', // fechar como conta pendente (fiado)
  'orders.delivery_fee_override',
  'payments.create',
  'payments.refund',
  'cash.open',
  'cash.movement',
  'cash.close',
  'cash.view_expected',
  'business_day.open',
  'business_day.manage', // fechar o dia
  'kitchen.view',
  'kitchen.update',
  'deliveries.manage',
  'deliveries.own',
  'couriers.settle',
  'menu.manage',
  'stock.view',
  'stock.manage',
  'expenses.manage',
  'customers.view',
  'customers.manage',
  'customers.erase',
  'reports.view', // consulta financeira
  'data.export',
  'whatsapp.inbox',
  'whatsapp.configure',
  'settings.manage',
  'users.manage',
  'audit.view',
  'backup.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const cashier: Permission[] = [
  'orders.view',
  'orders.create',
  'orders.edit',
  'orders.discount',
  'payments.create',
  'cash.open',
  'cash.movement',
  'business_day.open',
  'kitchen.view',
  'kitchen.update',
  'deliveries.manage',
  'stock.view',
  'customers.view',
  'customers.manage',
  'whatsapp.inbox',
];

const manager: Permission[] = PERMISSIONS.filter(
  (p) => !['users.manage', 'backup.manage', 'customers.erase', 'whatsapp.configure', 'deliveries.own'].includes(p),
);

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(PERMISSIONS.filter((p) => p !== 'deliveries.own')),
  manager: new Set(manager),
  cashier: new Set(cashier),
  kitchen: new Set<Permission>(['kitchen.view', 'kitchen.update']),
  courier: new Set<Permission>(['deliveries.own']),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** Tela inicial recomendada por perfil. */
export const ROLE_HOME: Record<Role, string> = {
  admin: '/pdv',
  manager: '/pdv',
  cashier: '/pdv',
  kitchen: '/cozinha',
  courier: '/entregador',
};
