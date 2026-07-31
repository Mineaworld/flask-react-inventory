import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, clearCsrfToken } from "../../lib/api";
import type { SessionUser } from "../../types/api";

type Credentials = {
  password: string;
  username: string;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  login: (credentials: Credentials) => Promise<SessionUser>;
  logout: () => Promise<void>;
  user: SessionUser | null;
};

type AuthProviderProps = {
  children: ReactNode;
  initialSession?: SessionUser | null;
};

const AUTH_QUERY_KEY = ["auth", "me"] as const;
const AuthContext = createContext<AuthContextValue | null>(null);

// provide auth wrap
export const AuthProvider = ({ children, initialSession }: AuthProviderProps) => {
  const queryClient = useQueryClient();
  const [sessionOverride, setSessionOverride] = useState<SessionUser | null | undefined>(initialSession);
  const sessionQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => apiClient.get<SessionUser>("/auth/me"),
    enabled: sessionOverride === undefined,
    retry: false,
    staleTime: 60_000,
  });
  const user = sessionOverride === undefined ? sessionQuery.data ?? null : sessionOverride;
  const loginMutation = useMutation({
    mutationFn: (credentials: Credentials) => apiClient.post<SessionUser>("/auth/login", credentials),
    onSuccess: (nextUser) => {
      queryClient.clear();
      setSessionOverride(nextUser);
      queryClient.setQueryData(AUTH_QUERY_KEY, nextUser);
    },
  });
  const logoutMutation = useMutation({
    mutationFn: () => apiClient.post<{ logged_out: boolean }>("/auth/logout"),
  });
  const login = useCallback((credentials: Credentials) => loginMutation.mutateAsync(credentials), [loginMutation]);
  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
    } finally {
      clearCsrfToken();
      queryClient.clear();
      setSessionOverride(null);
    }
  }, [logoutMutation, queryClient]);
  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: user !== null,
      isLoading: sessionOverride === undefined && sessionQuery.isPending,
      isSubmitting: loginMutation.isPending || logoutMutation.isPending,
      login,
      logout,
      user,
    }),
    [login, loginMutation.isPending, logout, logoutMutation.isPending, sessionOverride, sessionQuery.isPending, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// use auth hook
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return context;
}
