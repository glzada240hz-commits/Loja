import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ROLE_HOME, ROLE_LABEL, type Permission } from '@guto/core';
import { useAuth } from './lib/auth';
import { deviceKind, useLiveUpdates } from './lib/live';
import { Loading } from './components/ui';
import { Login } from './pages/Login';

const Pos = lazy(() => import('./pages/Pos'));
const Orders = lazy(() => import('./pages/Orders'));
const Tables = lazy(() => import('./pages/Tables'));
const Kitchen = lazy(() => import('./pages/Kitchen'));
const Dispatch = lazy(() => import('./pages/Dispatch'));
const Courier = lazy(() => import('./pages/Courier'));
const Cash = lazy(() => import('./pages/Cash'));
const Customers = lazy(() => import('./pages/Customers'));
const MenuAdmin = lazy(() => import('./pages/MenuAdmin'));
const Stock = lazy(() => import('./pages/Stock'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Reports = lazy(() => import('./pages/Reports'));
const WhatsApp = lazy(() => import('./pages/WhatsApp'));
const Settings = lazy(() => import('./pages/Settings'));
const Password = lazy(() => import('./pages/Password'));
const Waiter = lazy(() => import('./pages/waiter/Waiter'));
const Print = lazy(() => import('./pages/Print'));
const PublicMenu = lazy(() => import('./pages/public/PublicMenu'));
const Track = lazy(() => import('./pages/public/Track'));

function Private({ perm, children }: { perm?: Permission; children: ReactElement }) {
  const { me, can } = useAuth();
  const loc = useLocation();
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (perm && !can(perm)) return <Navigate to={ROLE_HOME[me.role]} replace />;
  return children;
}

export function App() {
  const { me, loading } = useAuth();
  const qc = useQueryClient();
  const loc = useLocation();
  const isPublic = loc.pathname === '/c' || loc.pathname.startsWith('/c/');
  useLiveUpdates(qc, !!me && !isPublic, me ? `${ROLE_LABEL[me.role]} · ${me.name} (${deviceKind()})` : 'Dispositivo');
  if (loading && !isPublic) return <Loading />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/c" element={<PublicMenu />} />
        <Route path="/c/pedido/:token" element={<Track />} />
        <Route path="/login" element={me ? <Navigate to={ROLE_HOME[me.role]} replace /> : <Login />} />
        <Route path="/pdv" element={<Private perm="orders.create"><Pos /></Private>} />
        <Route path="/pedidos" element={<Private perm="orders.view"><Orders /></Private>} />
        <Route path="/pedidos/:id" element={<Private perm="orders.view"><Orders /></Private>} />
        <Route path="/mesas" element={<Private perm="orders.view"><Tables /></Private>} />
        <Route path="/cozinha" element={<Private perm="kitchen.view"><Kitchen /></Private>} />
        <Route path="/expedicao" element={<Private perm="deliveries.manage"><Dispatch /></Private>} />
        <Route path="/entregador" element={<Private perm="deliveries.own"><Courier /></Private>} />
        <Route path="/caixa" element={<Private perm="cash.open"><Cash /></Private>} />
        <Route path="/clientes" element={<Private perm="customers.view"><Customers /></Private>} />
        <Route path="/cardapio" element={<Private perm="menu.manage"><MenuAdmin /></Private>} />
        <Route path="/estoque" element={<Private perm="stock.view"><Stock /></Private>} />
        <Route path="/despesas" element={<Private perm="expenses.manage"><Expenses /></Private>} />
        <Route path="/relatorios" element={<Private perm="reports.view"><Reports /></Private>} />
        <Route path="/whatsapp" element={<Private perm="whatsapp.inbox"><WhatsApp /></Private>} />
        <Route path="/ajustes" element={<Private perm="settings.manage"><Settings /></Private>} />
        <Route path="/atendente/*" element={<Private perm="tables.serve"><Waiter /></Private>} />
        <Route path="/senha" element={<Private><Password /></Private>} />
        <Route path="/imprimir/:id" element={<Private perm="orders.view"><Print /></Private>} />
        <Route path="*" element={<Navigate to={me ? ROLE_HOME[me.role] : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}
