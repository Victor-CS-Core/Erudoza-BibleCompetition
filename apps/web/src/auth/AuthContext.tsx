import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { Me } from "../api/types";

type AuthState = {
  me: Me | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      login: async (identifier, password) => {
        const next = await api.login(identifier, password);
        setMe(next);
        return next;
      },
      logout: async () => {
        await api.logout();
        setMe(null);
      },
      refresh,
    }),
    [me, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
