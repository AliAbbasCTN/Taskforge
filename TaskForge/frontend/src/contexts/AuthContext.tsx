import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../services/api';
import { refreshTokens, setAuthFailureHandler } from '../services/http';
import { disconnectRealtime } from '../services/realtime';
import { tokenStore } from '../services/tokenStore';
import type { User } from '../types/api';

/**
 * 'loading'         - we don't know yet (checking for a saved session)
 * 'authenticated'   - `user` is set
 * 'unauthenticated' - no session
 *
 * WHY a three-state status instead of just `user | null`: on a page reload
 * the user IS logged in, but we can't know until we've used the saved
 * refresh token. Treating "don't know yet" as "logged out" would flash the
 * login page at every logged-in user on every refresh.
 */
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * WHAT: Holds "who is logged in" for the whole app and exposes login,
 * register and logout.
 *
 * WHY React Context: the current user is needed in many unrelated places (the
 * sidebar, route protection, pages). Passing it down as props through every
 * layer ("prop drilling") would be noisy; context makes it available to any
 * component below the provider via `useAuth()`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const endSession = useCallback(() => {
    setUser(null);
    setStatus('unauthenticated');
    // Cached server data belongs to the previous user. Clearing it means the
    // next person to log in on this browser can never glimpse it.
    queryClient.clear();
  }, [queryClient]);

  // If the HTTP client discovers the session is dead (refresh token
  // rejected), it calls this to bounce the UI to the login page.
  useEffect(() => {
    setAuthFailureHandler(endSession);
    return () => setAuthFailureHandler(null);
  }, [endSession]);

  // On first load: if a refresh token was saved, try to resume the session.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!tokenStore.getRefreshToken()) {
        setStatus('unauthenticated');
        return;
      }
      try {
        // Single-flight, so React StrictMode's double-run in development
        // shares one request instead of burning the rotating token twice.
        if (!(await refreshTokens())) {
          throw new Error('Could not restore session');
        }
        const me = await authApi.me();
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setStatus('unauthenticated');
        }
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login({ email, password });
    tokenStore.set(result.tokens);
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const result = await authApi.register({ name, email, password });
      tokenStore.set(result.tokens);
      setUser(result.user);
      setStatus('authenticated');
    },
    [],
  );

  const logout = useCallback(async () => {
    // Close the socket ourselves first. Otherwise the server's own close (it
    // drops a user's sockets on logout) would look like an expired token and
    // the client would try to "recover" a connection it was told to end.
    disconnectRealtime();
    try {
      await authApi.logout();
    } catch {
      // Even if the server can't be told (offline, token already expired),
      // the user asked to log out: forget the session locally regardless.
    }
    tokenStore.clear();
    endSession();
  }, [endSession]);

  const value = useMemo(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
