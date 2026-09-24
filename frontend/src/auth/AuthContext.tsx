import { useEffect, useState, ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { AuthUser } from '../types';
import { AuthContext } from './auth-context';

const LAST_AUTH_KEY = 'adage.last-authenticated-user';
const LAST_AUTH_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function cacheUser(user: AuthUser) {
  // Unlike every other localStorage write added this session
  // (clockOffset.ts, employeeCache.ts, WelcomeBanner.tsx), this one was
  // never guarded — a throw here (private-browsing mode, quota exceeded,
  // storage disabled by policy) previously propagated out of both call
  // sites below: on login it surfaced as a false "unable to sign in"
  // error despite the server having authenticated successfully, and on
  // the initial-load path it caused the just-fetched valid user to be
  // discarded and replaced with null. Caching is a convenience for
  // offline reloads, not something either call site should ever fail on
  // top of. Found in the 2026-09-23 audit.
  try {
    localStorage.setItem(LAST_AUTH_KEY, JSON.stringify({ user, cachedAt: Date.now() }));
  } catch {
    // Best-effort only.
  }
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

// ApiError means the server actually answered (e.g. 401) — that's a real
// "you are logged out" signal, so don't fall back to the cache. Anything
// else (network failure, timeout, or genuinely offline) means we couldn't
// ask the server at all, so a cached session should still be trusted.
// Exported so the decision can be unit-tested without rendering React.
export function shouldUseCachedUser(err: unknown): boolean {
  return !(err instanceof ApiError);
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
        // The original check required `!navigator.onLine`, so a
        // reachable-WiFi-but-unreachable-server case (dead backend, DNS
        // hiccup, VPN drop) fell through to setUser(null) and logged out a
        // device with a perfectly valid cached session. Found in the
        // 2026-09-11 audit — see shouldUseCachedUser above.
        setUser(shouldUseCachedUser(err) ? readCachedUser() : null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string): Promise<AuthUser> {
    const res = await api.post<{ user: AuthUser }>('/auth/login', { username, password });
    setUser(res.user);
    cacheUser(res.user);
    return res.user;
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
