import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import type { Me } from "../api/types";

type AuthState = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  login: (identifier: string, password: string) => Promise<Me>;
  acceptSession: (session: Me) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const revision = useRef(0);
  const identity = useRef<Me | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const clearPrivateData = useCallback(async (currentRevision: number) => {
    if (currentRevision !== revision.current) return false;
    await queryClient.cancelQueries();
    if (currentRevision !== revision.current) return false;
    queryClient.clear();
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("erudoza:attempt:")) sessionStorage.removeItem(key);
    }
    return true;
  }, [queryClient]);
  const refresh = useCallback(async () => {
    const currentRevision = ++revision.current;
    setError(null);
    try {
      const next = await api.me();
      if (currentRevision !== revision.current) return;
      const previous = identity.current;
      if (!previous || previous.userId !== next.userId || previous.organizationId !== next.organizationId || previous.kind !== next.kind || previous.role !== next.role) {
        if (!await clearPrivateData(currentRevision)) return;
      }
      if (currentRevision !== revision.current) return;
      identity.current = next;
      setMe(next);
    } catch (failure) {
      if (currentRevision !== revision.current) return;
      if (failure instanceof ApiError && failure.status === 401) {
        if (!await clearPrivateData(currentRevision)) return;
        if (currentRevision !== revision.current) return;
        identity.current = null;
        setMe(null);
      } else {
        setError("We couldn’t reach the server. Check your connection and try again.");
      }
    } finally {
      if (currentRevision === revision.current) setLoading(false);
    }
  }, [clearPrivateData]);
  useEffect(() => { void refresh(); }, [refresh]);

  const acceptSession = useCallback(async (next: Me) => {
    const currentRevision = ++revision.current;
    if (!await clearPrivateData(currentRevision)) return;
    if (currentRevision !== revision.current) return;
    setError(null);
    identity.current = next;
    setMe(next);
    setLoading(false);
  }, [clearPrivateData]);

  const value = useMemo<AuthState>(() => ({
    me, loading, error, refresh, acceptSession,
    login: async (identifier, password) => {
      const currentRevision = ++revision.current;
      const next = await api.login(identifier, password);
      if (currentRevision !== revision.current) return next;
      await acceptSession(next);
      return next;
    },
    logout: async () => {
      const currentRevision = ++revision.current;
      await api.logout();
      if (!await clearPrivateData(currentRevision)) return;
      if (currentRevision !== revision.current) return;
      setError(null);
      identity.current = null;
      setMe(null);
      setLoading(false);
    },
  }), [me, loading, error, refresh, clearPrivateData, acceptSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
