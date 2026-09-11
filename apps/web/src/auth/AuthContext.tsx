import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import type { Me } from "../api/types";

type AuthState = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  login: (identifier: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const revision = useRef(0);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const clearPrivateData = useCallback(async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("erudoza:attempt:")) sessionStorage.removeItem(key);
    }
  }, [queryClient]);
  const refresh = useCallback(async () => {
    const currentRevision = ++revision.current;
    setError(null);
    try {
      const next = await api.me();
      if (currentRevision !== revision.current) return;
      setMe(next);
    } catch (failure) {
      if (currentRevision !== revision.current) return;
      if (failure instanceof ApiError && failure.status === 401) {
        await clearPrivateData();
        setMe(null);
      } else {
        setError("We couldn’t reach the server. Check your connection and try again.");
      }
    } finally {
      if (currentRevision === revision.current) setLoading(false);
    }
  }, [clearPrivateData]);
  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<AuthState>(() => ({
    me, loading, error, refresh,
    login: async (identifier, password) => {
      ++revision.current;
      const next = await api.login(identifier, password);
      await clearPrivateData();
      setError(null);
      setMe(next);
      setLoading(false);
      return next;
    },
    logout: async () => {
      ++revision.current;
      await api.logout();
      await clearPrivateData();
      setError(null);
      setMe(null);
      setLoading(false);
    },
  }), [me, loading, error, refresh, clearPrivateData]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
