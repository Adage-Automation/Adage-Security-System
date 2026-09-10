import { useEffect, useState, ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { AuthUser } from '../types';
import { AuthContext } from './auth-context';

const LAST_AUTH_KEY = 'adage.last-authenticated-user';
const LAST_AUTH_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function cacheUser(user: AuthUser) {
  localStorage.setItem(LAST_AUTH_KEY, JSON.stringify({ user, cachedAt: Date.now() }));
}

function readCachedUser(): AuthUser | null {
  try {
    const cached = JSON.parse(localStorage.getItem(LAST_AUTH_KEY) ?? 'null') as { user?: AuthUser; cachedAt?: number } | null;
    if (!cached?.user || !cached.cachedAt || Date.now() - cached.cachedAt > LAST_AUTH_MAX_AGE_MS) return null;
    return cached.user;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: AuthUser }>('/auth/me')
      .then((res) => {
        setUser(res.user);
        cacheUser(res.user);
      })
      .catch((err) => {
        if (!(err instanceof ApiError) && !navigator.onLine) setUser(readCachedUser());
        else setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const res = await api.post<{ user: AuthUser }>('/auth/login', { username, password });
    setUser(res.user);
    cacheUser(res.user);
  }

  async function logout() {
    await api.post('/auth/logout');
    setUser(null);
    localStorage.removeItem(LAST_AUTH_KEY);
  }

  function hasPermission(permission: string) {
    return user?.permissions.includes(permission) ?? false;
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}
