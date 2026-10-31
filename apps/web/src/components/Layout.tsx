import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  BarChart3,
  Bike,
  ChefHat,
  ClipboardList,
  KeyRound,
  LayoutGrid,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Smartphone,
  Users,
  UtensilsCrossed,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_LABEL, type Permission } from '@guto/core';
import { useAuth } from '../lib/auth';
import { get } from '../lib/api';
import { useConnection } from '../lib/live';
import { formatDate } from '../lib/format';
import { Logo } from './Logo';
import { Button } from './ui';
import { StaffAlerts } from './StaffAlerts';
import { UpdateBanner } from './UpdateBanner';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm: Permission;
}
type NavEntry = NavItem | { group: string };
const NAV: NavEntry[] = [
  { group: 'Operação' },
  { to: '/pdv', label: 'Venda (PDV)', icon: ShoppingCart, perm: 'orders.create' },
  { to: '/mesas', label: 'Mesas e comandas', icon: LayoutGrid, perm: 'orders.view' },
  { to: '/pedidos', label: 'Pedidos', icon: ClipboardList, perm: 'orders.view' },
  { to: '/cozinha', label: 'Cozinha', icon: ChefHat, perm: 'kitchen.view' },
  { to: '/expedicao', label: 'Entregas', icon: Bike, perm: 'deliveries.manage' },
  { to: '/entregador', label: 'Minhas entregas', icon: Bike, perm: 'deliveries.own' },
  { to: '/atendente', label: 'App do atendente', icon: Smartphone, perm: 'tables.serve' },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, perm: 'whatsapp.inbox' },
  { group: 'Gestão' },
  { to: '/caixa', label: 'Caixa e dia', icon: Banknote, perm: 'cash.open' },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3, perm: 'reports.view' },
  { to: '/cardapio', label: 'Cardápio', icon: UtensilsCrossed, perm: 'menu.manage' },
  { to: '/estoque', label: 'Estoque', icon: Package, perm: 'stock.view' },
  { to: '/despesas', label: 'Despesas', icon: Receipt, perm: 'expenses.manage' },
  { to: '/clientes', label: 'Clientes', icon: Users, perm: 'customers.view' },
  { to: '/ajustes', label: 'Ajustes', icon: Settings, perm: 'settings.manage' },
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
        <span className="spin" style={{ width: 10, height: 10, borderWidth: 2 }} aria-hidden /> Conectando…
      </span>
    );
  return (
    <span className="conn bad" role="status">
      <WifiOff className="icon" aria-hidden /> Sem conexão
    </span>
  );
}

/** Dia e caixa: discreto quando está tudo aberto, destacado quando falta abrir. */
export function DayStatus() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['day'], queryFn: () => get('/api/day'), refetchInterval: 60000, enabled: can('orders.view') || can('kitchen.view') });
  if (!q.data) return null;
  const { day, cash } = q.data;
  if (!day)
    return (
      <NavLink to={can('cash.open') ? '/caixa' : '#'} className="conn bad" style={{ textDecoration: 'none' }}>
        Dia fechado
      </NavLink>
    );
  const cashLabel = can('cash.open') ? (cash ? 'caixa aberto' : 'caixa fechado') : null;
  return (
    <span className={'conn ' + (cashLabel === 'caixa fechado' ? 'wait' : 'neutral')} title="Dia operacional em andamento">
      Dia {formatDate(day.referenceDate + 'T12:00:00').slice(0, 5)}
      {cashLabel && ` · ${cashLabel}`}
    </span>
  );
}

const initials = (name?: string) =>
  (name ?? '?')
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

export function Layout({ children, title, actions, flush }: { children: ReactNode; title?: ReactNode; actions?: ReactNode; flush?: boolean }) {
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const conn = useConnection();
  const allowed = NAV.filter((i) => 'group' in i || can(i.perm));
  // remove títulos de grupo sem itens
  const items = allowed.filter((i, idx) => !('group' in i) || (allowed[idx + 1] && !('group' in allowed[idx + 1]!)));
  const links = items.filter((i): i is NavItem => !('group' in i));
  // perfis com uma única tela (cozinha, entregador) não precisam de barra lateral
  const noNav = links.length <= 1;
  return (
    <div className={'app' + (noNav ? ' no-nav' : '')}>
      {!noNav && (
        <aside className={'sidebar' + (open ? ' open' : '')} onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
          <div className="brand">
            <Logo />
            <span>
              Bar do Guto
              <small>Gestão da loja</small>
            </span>
          </div>
          <nav className="nav" aria-label="Principal">
            {items.map((i, idx) =>
              'group' in i ? (
                idx === 0 ? (
                  <div key={i.group} className="nav-group">
                    {i.group}
                  </div>
                ) : (
                  <div key={i.group}>
                    <div className="nav-sep" />
                    <div className="nav-group">{i.group}</div>
                  </div>
                )
              ) : (
                <NavLink key={i.to} to={i.to} title={i.label} className={({ isActive }) => (isActive || loc.pathname.startsWith(i.to + '/') ? 'active' : '')}>
                  <i.icon className="icon" size={20} aria-hidden /> <span className="label">{i.label}</span>
                </NavLink>
              ),
            )}
          </nav>
          <UserFoot name={me?.name} role={me ? ROLE_LABEL[me.role] : ''} onLogout={() => void logout()} />
        </aside>
      )}
      <div className="main">
        {conn === 'offline' && (
          <div className="offline-banner" role="alert">
            <WifiOff size={18} aria-hidden /> Sem conexão com o servidor. Nada que você fizer agora será salvo até a conexão voltar; os dados exibidos podem estar desatualizados.
          </div>
        )}
        <UpdateBanner />
        <header className="topbar">
          {!noNav && <Button className="menu-toggle" size="sm" variant="ghost" icon={Menu} aria-label="Abrir menu" onClick={() => setOpen(true)} />}
          <span className="brand-mini" aria-hidden>
            <Logo size={28} />
          </span>
          {title && <h1>{title}</h1>}
          <div className="grow" />
          {actions}
          <div className="topbar-status">
            <DayStatus />
            <StaffAlerts />
            <ConnectionPill />
          </div>
          {noNav && (
            <>
              <span className="who" style={{ flex: '0 1 auto', textAlign: 'right' }}>
                <b>{me?.name}</b>
                <small className="muted">{me ? ROLE_LABEL[me.role] : ''}</small>
              </span>
              <Button size="sm" variant="ghost" icon={LogOut} onClick={() => void logout()}>
                Sair
              </Button>
            </>
          )}
        </header>
        <main className={'content' + (flush ? ' flush' : '')}>{children}</main>
      </div>
    </div>
  );
}

function UserFoot({ name, role, onLogout }: { name?: string; role: string; onLogout: () => void }) {
  return (
    <div className="sidebar-foot">
      <span className="avatar" aria-hidden>
        {initials(name)}
      </span>
      <span className="who">
        <b>{name}</b>
        <small className="muted">{role}</small>
      </span>
      <span className="foot-actions hstack" style={{ gap: 2, flexWrap: 'nowrap' }}>
        <NavLink to="/senha" className="btn ghost sm icon-only" title="Alterar senha" aria-label="Alterar senha">
          <KeyRound className="icon" aria-hidden />
        </NavLink>
        <Button size="sm" variant="ghost" icon={LogOut} title="Sair" aria-label="Sair" onClick={onLogout} />
      </span>
    </div>
  );
}
