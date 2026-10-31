import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { UiProvider } from './components/ui';
import '@fontsource-variable/inter';
import './styles.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5000 },
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <UiProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </UiProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// PWA: registra o service worker (só cacheia a interface; dados sempre do servidor)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const loadedAt = Date.now();
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        // logo ao abrir o app nada está em andamento: aplica a versão nova na hora
        if (Date.now() - loadedAt < 15000) return void update(true);
        // depois disso, aviso discreto (UpdateBanner); não interrompe quem está lançando um pedido
        window.dispatchEvent(new CustomEvent('guto:update', { detail: () => void update(true) }));
      },
      onRegisteredSW(_url, reg) {
        // procura versão nova a cada 10 minutos e quando o aparelho volta a ficar visível
        if (!reg) return;
        setInterval(() => void reg.update().catch(() => undefined), 10 * 60 * 1000);
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void reg.update().catch(() => undefined));
      },
    });
  });
}
