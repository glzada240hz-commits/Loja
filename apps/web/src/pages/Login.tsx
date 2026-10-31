import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ROLE_HOME } from '@guto/core';
import { useAuth } from '../lib/auth';
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
      <form
        className="card"
        style={{ width: 'min(400px, 100%)', padding: 28, boxShadow: 'var(--shadow-3)' }}
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
        <div className="hstack" style={{ marginBottom: 20, gap: 12 }}>
          <Logo size={48} />
          <div>
            <h1 style={{ margin: 0 }}>Bar do Guto</h1>
            <small className="muted">Entre com seu usuário para começar o turno</small>
          </div>
        </div>
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
  );
}
