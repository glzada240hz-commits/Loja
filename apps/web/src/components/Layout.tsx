import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABEL, type Permission } from '@guto/core';
import { useAuth } from '../lib/auth';
import { get } from '../lib/api';
import { useConnection } from '../lib/live';
import { formatDate } from '../lib/format';
import { Logo } from './Logo';
import { Button } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  perm: Permission;
}
const NAV: (NavItem | 'sep')[] = [
  { to: '/pdv', label: 'Venda (PDV)', icon: '🧾', perm: 'orders.create' },
  { to: '/pedidos', label: 'Pedidos', icon: '📋', perm: 'orders.view' },
  { to: '/mesas', label: 'Mesas', icon: '🍽️', perm: 'orders.view' },
  { to: '/cozinha', label: 'Cozinha', icon: '👨‍🍳', perm: 'kitchen.view' },
  { to: '/expedicao', label: 'Entregas', icon: '🛵', perm: 'deliveries.manage' },
  { to: '/entregador', label: 'Minhas entregas', icon: '🛵', perm: 'deliveries.own' },
  { to: '/whatsapp', label: 'WhatsApp', icon: '💬', perm: 'whatsapp.inbox' },
  'sep',
  { to: '/caixa', label: 'Caixa e dia', icon: '💰', perm: 'cash.open' },
  { to: '/clientes', label: 'Clientes', icon: '👥', perm: 'customers.view' },
  { to: '/cardapio', label: 'Cardápio', icon: '🍔', perm: 'menu.manage' },
  { to: '/estoque', label: 'Estoque', icon: '📦', perm: 'stock.view' },
  { to: '/despesas', label: 'Despesas', icon: '🧮', perm: 'expenses.manage' },
  { to: '/relatorios', label: 'Relatórios', icon: '📊', perm: 'reports.view' },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙️', perm: 'settings.manage' },
];

export function ConnectionPill() {
  const c = useConnection();
  if (c === 'online')
    return (
      <span className="conn ok" title="Recebendo atualizações em tempo real">
        <i /> Online
      </span>
    );
  if (c === 'connecting')
    return (
      <span className="conn wait">
        <i /> Conectando…
      </span>
    );
  return (
    <span className="conn bad" role="status">
      <i /> Sem conexão
    </span>
  );
}

export function DayStatus() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['day'], queryFn: () => get('/api/day'), refetchInterval: 60000, enabled: can('orders.view') || can('kitchen.view') });
  if (!q.data) return null;
  const { day, cash } = q.data;
  return (
    <span className="hstack">
      {day ? <span className="badge green">Dia aberto · {formatDate(day.referenceDate + 'T12:00:00')}</span> : <span className="badge red">Dia fechado</span>}
      {can('cash.open') && (cash ? <span className="badge green">Caixa aberto</span> : <span className="badge orange">Caixa fechado</span>)}
    </span>
  );
}

export function Layout({ children, title, actions, flush }: { children: ReactNode; title?: ReactNode; actions?: ReactNode; flush?: boolean }) {
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const conn = useConnection();
  const items = NAV.filter((i) => i === 'sep' || can(i.perm));
  return (
    <div className="app">
      <aside className={'sidebar' + (open ? ' open' : '')} onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
        <div className="brand">
          <Logo />
          <span>
            Bar do Guto
            <small>Gestão</small>
          </span>
        </div>
        <nav className="nav" aria-label="Principal">
          {items.map((i, idx) =>
            i === 'sep' ? (
              <div key={'s' + idx} className="nav-sep" />
            ) : (
              <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive || loc.pathname.startsWith(i.to + '/') ? 'active' : '')}>
                <span aria-hidden>{i.icon}</span> {i.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="sidebar-foot">
          <div>
            <b>{me?.name}</b>
          </div>
          <div>{me ? ROLE_LABEL[me.role] : ''}</div>
          <div className="hstack">
            <NavLink to="/senha" style={{ color: '#c8bba9', fontSize: '.85rem' }}>
              Alterar senha
            </NavLink>
            <Button size="sm" variant="ghost" style={{ color: '#f5efe6' }} onClick={() => void logout()}>
              Sair
            </Button>
          </div>
        </div>
      </aside>
      <div className="main">
        {conn === 'offline' && (
          <div className="offline-banner" role="alert">
            Sem conexão com o servidor. Nada que você fizer agora será salvo até a conexão voltar. Os dados exibidos podem estar desatualizados.
          </div>
        )}
        <header className="topbar">
          <Button className="menu-toggle" size="sm" variant="ghost" aria-label="Abrir menu" onClick={() => setOpen(true)}>
            ☰
          </Button>
          {title && <h1 style={{ margin: 0, fontSize: '1.15rem' }}>{title}</h1>}
          <div className="grow" />
          {actions}
          <DayStatus />
          <ConnectionPill />
        </header>
        <main className={'content' + (flush ? ' flush' : '')}>{children}</main>
      </div>
    </div>
  );
}
