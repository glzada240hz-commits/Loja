import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ROLE_HOME, type Role } from '@guto/core';
import { currentUser, installMockApi, loginAs, resetDemo } from './mockApi';
import { App } from '../App';
import { AuthProvider } from '../lib/auth';
import { UiProvider, useUi } from '../components/ui';
import '../styles.css';
import './demo.css';

installMockApi();

const PROFILES: { user: string | null; label: string; role?: Role; path: string }[] = [
  { user: 'gerente', label: 'Gerente', role: 'manager', path: ROLE_HOME.manager },
  { user: 'caixa', label: 'Caixa', role: 'cashier', path: ROLE_HOME.cashier },
  { user: 'cozinha', label: 'Cozinha', role: 'kitchen', path: ROLE_HOME.kitchen },
  { user: 'moto1', label: 'Entregador', role: 'courier', path: ROLE_HOME.courier },
  { user: null, label: 'Cliente (cardápio)', path: '/c' },
];

/** Links internos (/caixa, /imprimir/…) navegam dentro da demonstração em vez de abrir outra página. */
function LinkInterceptor() {
  const nav = useNavigate();
  const ui = useUi();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      const href = a?.getAttribute('href');
      if (!a || !href || !href.startsWith('/')) return;
      e.preventDefault();
      if (href.startsWith('/api/')) {
        ui.toast('Exportação CSV não está disponível na demonstração (funciona no sistema instalado).', 'info');
        return;
      }
      nav(href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [nav, ui]);
  return null;
}

function Demo() {
  // abre já em uso, como gerente, na tela de venda
  const [session, setSession] = useState(() => {
    loginAs(currentUser() ?? 'gerente');
    return { key: 0, path: '/pdv' };
  });
  const [active, setActive] = useState<string>(() => PROFILES.find((p) => p.user === (currentUser() ?? 'gerente'))?.label ?? '');
  const [confirmReset, setConfirmReset] = useState(false);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0, staleTime: 2000 } } });
  const go = (p: (typeof PROFILES)[number]) => {
    loginAs(p.user ?? '');
    setActive(p.label);
    setSession((s) => ({ key: s.key + 1, path: p.path }));
  };
  return (
    <div className="demo-shell">
      <div className="demo-bar" role="region" aria-label="Controles da demonstração">
        <span className="demo-tag">DEMONSTRAÇÃO</span>
        <span className="demo-hint">Dados fictícios, só neste navegador. Entrar como:</span>
        <div className="demo-profiles">
          {PROFILES.map((p) => (
            <button key={p.label} type="button" aria-pressed={active === p.label} onClick={() => go(p)}>
              {p.label}
            </button>
          ))}
        </div>
        {confirmReset ? (
          <span className="demo-reset">
            Apagar tudo e recomeçar?
            <button type="button" onClick={() => { resetDemo(); loginAs('gerente'); setConfirmReset(false); setActive('Gerente'); setSession((s) => ({ key: s.key + 1, path: '/pdv' })); }}>Sim</button>
            <button type="button" onClick={() => setConfirmReset(false)}>Não</button>
          </span>
        ) : (
          <button type="button" className="demo-reset-btn" onClick={() => setConfirmReset(true)}>
            Reiniciar dados
          </button>
        )}
      </div>
      <div className="demo-app" key={session.key}>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[session.path]}>
            <UiProvider>
              <AuthProvider>
                <LinkInterceptor />
                <App />
              </AuthProvider>
            </UiProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
