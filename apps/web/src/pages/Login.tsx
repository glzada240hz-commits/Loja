import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ROLE_HOME } from '@guto/core';
import { useAuth } from '../lib/auth';
import { ChefHat, ShoppingCart, Smartphone } from 'lucide-react';
import { Alert, Button, Field } from '../components/ui';
import { Logo } from '../components/Logo';

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <aside className="login-brand">
        <div className="hstack" style={{ gap: 12 }}>
          <Logo size={150} />
          <h2 className="sr-only">Bar do Guto</h2>
        </div>
        <div>
          <p>Pedidos do balcão, das mesas e do delivery num só lugar — caixa, cozinha e atendentes em tempo real.</p>
          <ul>
            <li><ShoppingCart className="icon" aria-hidden /> Venda rápida com atalhos de teclado</li>
            <li><ChefHat className="icon" aria-hidden /> Cozinha recebe na hora, sem papel</li>
            <li><Smartphone className="icon" aria-hidden /> App do atendente no celular</li>
          </ul>
        </div>
        <span className="login-foot">Versão {__BUILD__.id}</span>
      </aside>
      <div className="login-form">
      <form

        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setErr(null);
          try {
            await login(username, password);
            const me = await fetch('/api/auth/me').then((r) => r.json());
            nav(loc.state?.from ?? ROLE_HOME[me.user.role as keyof typeof ROLE_HOME], { replace: true });
          } catch (e2) {
            setErr((e2 as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Entrar</h1>
        <p className="muted" style={{ marginBottom: 20 }}>Use seu usuário e senha para começar o turno.</p>
        {err && <Alert kind="error">{err}</Alert>}
        <Field label="Usuário">
          <input autoFocus autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setU(e.target.value)} required />
        </Field>
        <Field label="Senha">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required />
        </Field>
        <Button type="submit" variant="primary" size="lg" block busy={busy}>
          Entrar
        </Button>
        <p style={{ marginTop: 16, marginBottom: 0, textAlign: 'center', fontSize: '.875rem' }}>
          <a href="/c">Ver cardápio digital (clientes)</a>
        </p>
      </form>
      </div>
    </div>
  );
}
