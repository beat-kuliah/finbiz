import { create } from "zustand";
import { apiJson, bindOnRefreshed, bindTokenGetter } from "@/lib/api";

export type User = {
  id: string;
  email: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string;
};

export type Org = {
  id: string;
  name: string;
  businessType: string;
  currency: string;
  role: string;
};

type AuthState = {
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
  user: User | null;
  accessToken: string | null;
  orgs: Org[];
  activeOrgId: string | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<{ isNew: boolean }>;
  logout: () => Promise<void>;
  loadOrgs: () => Promise<void>;
  setActiveOrgId: (id: string | null) => void;
};

export const useAuth = create<AuthState>((set, get) => ({
  status: "idle",
  user: null,
  accessToken: null,
  orgs: [],
  activeOrgId: localStorage.getItem("finbiz.activeOrg"),
  bootstrap: async () => {
    set({ status: "loading" });
    try {
      const refreshed = await apiJson<{ accessToken: string }>("/api/auth/refresh", { method: "POST" });
      set({ accessToken: refreshed.accessToken });
      const me = await apiJson<{ user: User }>("/api/auth/me");
      set({ user: me.user, status: "authenticated" });
      await get().loadOrgs();
    } catch {
      set({ status: "unauthenticated", user: null, accessToken: null, orgs: [] });
    }
  },
  login: async (email, password) => {
    const res = await apiJson<{ user: User; accessToken: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    set({ user: res.user, accessToken: res.accessToken, status: "authenticated" });
    await get().loadOrgs();
  },
  register: async (name, email, password) => {
    const res = await apiJson<{ user: User; accessToken: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    set({ user: res.user, accessToken: res.accessToken, status: "authenticated" });
    await get().loadOrgs();
  },
  loginWithGoogle: async (idToken) => {
    const res = await apiJson<{ user: User; accessToken: string }>("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
    set({ user: res.user, accessToken: res.accessToken, status: "authenticated" });
    await get().loadOrgs();
    // New Google accounts start with no orgs → send to onboarding.
    return { isNew: get().orgs.length === 0 };
  },
  logout: async () => {
    try {
      await apiJson("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    localStorage.removeItem("finbiz.activeOrg");
    set({ user: null, accessToken: null, status: "unauthenticated", orgs: [], activeOrgId: null });
  },
  loadOrgs: async () => {
    const res = await apiJson<{ organizations: Org[] }>("/api/orgs");
    const orgs = res.organizations ?? [];
    let active = get().activeOrgId;
    if (active && !orgs.some((o) => o.id === active)) active = null;
    if (!active && orgs.length) active = orgs[0].id;
    if (active) localStorage.setItem("finbiz.activeOrg", active);
    set({ orgs, activeOrgId: active });
  },
  setActiveOrgId: (id) => {
    if (id) localStorage.setItem("finbiz.activeOrg", id);
    else localStorage.removeItem("finbiz.activeOrg");
    set({ activeOrgId: id });
  },
}));

bindTokenGetter(() => useAuth.getState().accessToken);
bindOnRefreshed((token) => useAuth.setState({ accessToken: token }));
