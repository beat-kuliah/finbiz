import { create } from "zustand";
import { apiJson, bindOnAuthFailed, bindOnRefreshed, bindTokenGetter } from "@/lib/api";

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  isPlatformAdmin: boolean;
};

type AuthState = {
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
  user: AdminUser | null;
  accessToken: string | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearSession: () => void;
};

export const useAuth = create<AuthState>((set, get) => ({
  status: "idle",
  user: null,
  accessToken: null,
  bootstrap: async () => {
    set({ status: "loading" });
    try {
      const refreshed = await apiJson<{ accessToken: string }>("/api/platform/auth/refresh", {
        method: "POST",
      });
      set({ accessToken: refreshed.accessToken });
      const me = await apiJson<{ user: AdminUser }>("/api/platform/auth/me");
      set({ user: me.user, status: "authenticated" });
    } catch {
      get().clearSession();
    }
  },
  login: async (email, password) => {
    const res = await apiJson<{ user: AdminUser; accessToken: string }>("/api/platform/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    set({ user: res.user, accessToken: res.accessToken, status: "authenticated" });
  },
  logout: async () => {
    try {
      await apiJson("/api/platform/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    get().clearSession();
  },
  clearSession: () => {
    set({ user: null, accessToken: null, status: "unauthenticated" });
  },
}));

bindTokenGetter(() => useAuth.getState().accessToken);
bindOnRefreshed((token) => useAuth.setState({ accessToken: token }));
bindOnAuthFailed(() => useAuth.getState().clearSession());
