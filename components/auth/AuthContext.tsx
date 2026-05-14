import React from 'react';
import { fetchMe, loginByEmail, logoutSession, registerByEmail, type AuthUser } from '../../services/authClient';
import { setGeminiFairnessUserId } from '../../services/geminiFairnessBridge';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetchMe();
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = React.useCallback(async (identifier: string, password: string) => {
    const res = await loginByEmail(identifier, password);
    setUser(res.user);
  }, []);

  const register = React.useCallback(async (username: string, email: string, password: string) => {
    const res = await registerByEmail(username, email, password);
    setUser(res.user);
  }, []);

  const logout = React.useCallback(async () => {
    await logoutSession();
    setUser(null);
  }, []);

  React.useEffect(() => {
    setGeminiFairnessUserId(user?.id ?? null);
  }, [user]);

  const value = React.useMemo<AuthContextValue>(() => ({
    user,
    loading,
    login,
    register,
    logout,
    refresh,
  }), [user, loading, login, register, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}

