import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from '@/lib/api';
import { setLocaleSettings } from '@/lib/format';
import type { Me } from '@/lib/types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  register: (input: { name: string; email: string; password: string; companyName?: string; phone?: string }) => Promise<Me>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

// Non-sensitive hint ("this browser had a session") so logged-out visitors don't fire a pointless refresh request.
// It grants nothing: the httpOnly refresh cookie and server checks remain the only authority.
const HINT = 'bl_session_hint';
const hint = {
  has: () => {
    try { return localStorage.getItem(HINT) === '1'; } catch { return true; }
  },
  set: () => { try { localStorage.setItem(HINT, '1'); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(HINT); } catch { /* ignore */ } },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const loadSettings = useCallback(async (role: Me['role']) => {
    try {
      const s = await api.get<{ data: { currency: string; timezone: string } }>(role === 'CUSTOMER' ? '/portal/config' : '/settings');
      setLocaleSettings(s.data.currency, s.data.timezone);
    } catch {
      /* formatting falls back to defaults */
    }
  }, []);

  const refreshMe = useCallback(async () => {
    const me = await api.get<{ data: Me }>('/auth/me');
    setUser(me.data);
  }, []);

  // Restore the session from the httpOnly refresh cookie on page load.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      hint.clear();
      setAccessToken(null);
      setUser(null);
      qc.clear();
    });
    (async () => {
      if (hint.has() && (await refreshSession())) {
        try {
          const me = await api.get<{ data: Me }>('/auth/me');
          setUser(me.data);
          await loadSettings(me.data.role);
        } catch {
          setUser(null);
        }
      } else {
        hint.clear();
      }
      setLoading(false);
    })();
  }, [qc, loadSettings]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<{ data: { accessToken: string; user: Me } }>('/auth/login', { email, password });
      setAccessToken(res.data.accessToken);
      hint.set();
      setUser(res.data.user);
      await loadSettings(res.data.user.role);
      return res.data.user;
    },
    [loadSettings],
  );

  const register = useCallback(async (input: { name: string; email: string; password: string; companyName?: string; phone?: string }) => {
    const res = await api.post<{ data: { accessToken: string; user: Me } }>('/auth/register', input);
    setAccessToken(res.data.accessToken);
    hint.set();
    setUser(res.data.user);
    await loadSettings(res.data.user.role);
    return res.data.user;
  }, [loadSettings]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    hint.clear();
    setAccessToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, refreshMe, can: (p) => Boolean(user?.permissions.includes(p)) }),
    [user, loading, login, register, logout, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const homeFor = (user: Me) => (user.role === 'CUSTOMER' ? '/portal' : '/overview');
