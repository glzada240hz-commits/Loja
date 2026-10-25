import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Permission, Role } from '@guto/core';
import { ApiError, get, post } from './api';

export interface Me {
  id: string;
  name: string;
  username: string;
  role: Role;
}
interface AuthState {
  me: Me | null;
  perms: Set<string>;
  loading: boolean;
  can(p: Permission): boolean;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await get<{ user: Me; permissions: string[] }>('/api/auth/me');
      setMe(r.user);
      setPerms(new Set(r.permissions));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setPerms(new Set());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onUnauth = () => {
      setMe(null);
      setPerms(new Set());
    };
    window.addEventListener('guto:unauthorized', onUnauth);
    return () => window.removeEventListener('guto:unauthorized', onUnauth);
  }, [load]);

  const value: AuthState = {
    me,
    perms,
    loading,
    can: (p) => perms.has(p),
    async login(username, password) {
      const r = await post<{ user: Me; permissions: string[] }>('/api/auth/login', { username, password });
      setMe(r.user);
      setPerms(new Set(r.permissions));
    },
    async logout() {
      await post('/api/auth/logout').catch(() => undefined);
      setMe(null);
      setPerms(new Set());
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider ausente');
  return v;
}
