import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMe, loginByEmail, logoutSession, type AuthUser } from '../services/authClient';
import { HttpRequestError } from '../services/httpClient';

type AuthCtx = {
  user: AuthUser | null | undefined;
  error: string | null;
  refresh: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { user: u } = await fetchMe();
      setUser(u);
    } catch (e) {
      if (e instanceof HttpRequestError && e.status === 401) {
        setUser(null);
        return;
      }
      setUser(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (identifier: string, password: string) => {
    setError(null);
    await loginByEmail(identifier.trim(), password);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    setError(null);
    await logoutSession();
    setUser(null);
  }, []);

  const v = useMemo(() => ({ user, error, refresh, login, logout }), [user, error, refresh, login, logout]);

  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const x = useContext(Ctx);
  if (!x) throw new Error('useAuth 须在 AuthProvider 内');
  return x;
}
