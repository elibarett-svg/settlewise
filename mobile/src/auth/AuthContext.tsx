import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api, setAuthToken, setUnauthorizedHandler } from '../api/client';
import type { TokenResponse, User } from '../api/types';
import { storage } from '../lib/storage';

const TOKEN_KEY = 'settlewise.token';

interface AuthState {
  ready: boolean;
  user: User | null;
  signIn: (email: string, password: string, totpCode?: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, language: string) => Promise<void>;
  signOut: () => Promise<void>;
  acceptToken: (res: TokenResponse) => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const qc = useQueryClient();

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    qc.clear();
    await storage.remove(TOKEN_KEY);
  }, [qc]);

  const acceptToken = useCallback(async (res: TokenResponse) => {
    setAuthToken(res.access_token);
    await storage.set(TOKEN_KEY, res.access_token);
    setUser(res.user);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    (async () => {
      const stored = await storage.get(TOKEN_KEY);
      if (stored) {
        setAuthToken(stored);
        try {
          setUser(await api<User>('/account/me'));
        } catch {
          await signOut();
        }
      }
      setReady(true);
    })();
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      signOut,
      acceptToken,
      setUser,
      signIn: async (email, password, totpCode) => {
        const res = await api<TokenResponse>('/auth/login', {
          method: 'POST',
          body: { email, password, totp_code: totpCode || undefined },
        });
        await acceptToken(res);
      },
      signUp: async (email, password, fullName, language) => {
        const res = await api<TokenResponse>('/auth/register', {
          method: 'POST',
          body: { email, password, full_name: fullName, display_language: language },
        });
        await acceptToken(res);
      },
      refreshUser: async () => setUser(await api<User>('/account/me')),
    }),
    [ready, user, signOut, acceptToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
