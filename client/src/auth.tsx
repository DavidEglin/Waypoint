import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CurrentUser, LoginRequest, Theme } from '@waypoint/shared';
import { ApiFailure, SESSION_ENDED_EVENT, api } from './api';
import { applyTheme } from './theme';

interface AuthState {
  /** undefined while the first check is running, null when signed out. */
  user: CurrentUser | null | undefined;
  signIn(req: LoginRequest): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  const adopt = useCallback((u: CurrentUser | null) => {
    setUser(u);
    if (u) applyTheme(u.theme);
  }, []);

  const refresh = useCallback(async () => {
    try {
      adopt(await api<CurrentUser>('GET', '/api/me'));
    } catch (e) {
      // Only a definite "not signed in" clears the user; a network blip should not sign anyone out.
      if (e instanceof ApiFailure && e.status === 401) adopt(null);
      else if (user === undefined) adopt(null);
    }
  }, [adopt, user]);

  useEffect(() => {
    void refresh();
    const ended = () => setUser(null);
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AuthState = {
    user,
    refresh,
    signIn: async (req) => adopt(await api<CurrentUser>('POST', '/api/session', req)),
    signOut: async () => {
      try {
        await api('DELETE', '/api/session');
      } finally {
        setUser(null);
      }
    },
    setTheme: async (theme) => {
      // Optimistic: the choice shows straight away; Settings reports it if saving to the account fails.
      applyTheme(theme);
      setUser((u) => (u ? { ...u, theme } : u));
      await api('PATCH', '/api/me/settings', { theme });
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
