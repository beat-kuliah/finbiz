import { useEffect } from "react";
import {
  BookOpen,
  Building2,
  Contact,
  CreditCard,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Receipt,
  Settings,
  Sun,
  ArrowLeftRight,
  Wallet,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { t } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import { usePreferences } from "@/store/preferences";

export function AppShell() {
  const { user, orgs, activeOrgId, setActiveOrgId, logout } = useAuth();
  const { theme, locale, setTheme, hydrate } = usePreferences();
  const navigate = useNavigate();
  const m = t(locale);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const groups = [
    {
      title: m.groups.operasi,
      items: [
        { to: "/dashboard", label: m.nav.dashboard, icon: LayoutDashboard },
        { to: "/transactions", label: m.nav.transactions, icon: ArrowLeftRight },
        { to: "/cash", label: m.nav.cash, icon: Wallet },
        { to: "/contacts", label: m.nav.contacts, icon: Contact },
      ],
    },
    {
      title: m.groups.keuangan,
      items: [
        { to: "/capital", label: m.nav.capital, icon: Landmark },
        { to: "/payables", label: m.nav.payables, icon: CreditCard },
        { to: "/receivables", label: m.nav.receivables, icon: Receipt },
        { to: "/assets", label: m.nav.assets, icon: Package },
      ],
    },
    {
      title: m.groups.laporan,
      items: [
        { to: "/accounts", label: m.nav.accounts, icon: BookOpen },
        { to: "/journals", label: m.nav.journals, icon: FileText },
        { to: "/reports", label: m.nav.reports, icon: Building2 },
        { to: "/billing", label: m.nav.billing, icon: CreditCard },
      ],
    },
  ];

  return (
    <div className="min-h-screen md:grid md:grid-cols-[272px_1fr] bg-paper text-ink">
      <aside className="sidebar-panel hidden md:flex flex-col px-3 py-5">
        <div className="px-3 mb-6">
          <div className="font-display text-2xl text-white tracking-tight">{m.brand}</div>
          <p className="text-sm text-white/65 mt-1 truncate">{user?.name}</p>
        </div>

        <label className="px-3 text-[11px] uppercase tracking-[0.14em] text-white/45 mb-1.5">
          {m.activeBusiness}
        </label>
        <select
          className="mx-1 mb-5 rounded-lg border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40"
          value={activeOrgId ?? ""}
          onChange={(e) => setActiveOrgId(e.target.value || null)}
        >
          {orgs.length === 0 && <option value="">{m.noBusiness}</option>}
          {orgs.map((o) => (
            <option key={o.id} value={o.id} className="text-ink">
              {o.name}
            </option>
          ))}
        </select>

        <nav className="flex-1 overflow-y-auto space-y-5 px-1">
          {groups.map((group) => (
            <div key={group.title}>
              <div className="px-3 mb-1.5 text-[11px] uppercase tracking-[0.14em] text-white/40">
                {group.title}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        [
                          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                          isActive
                            ? "sidebar-link-active"
                            : "text-white/80 hover:bg-white/10 hover:text-white",
                        ].join(" ")
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-4 space-y-1 border-t border-white/10 pt-4 px-1">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                isActive ? "sidebar-link-active" : "text-white/80 hover:bg-white/10 hover:text-white",
              ].join(" ")
            }
          >
            <Settings className="h-4 w-4" strokeWidth={2} />
            {m.settings}
          </NavLink>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={m.theme}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? m.themeLight : m.themeDark}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            <LogOut className="h-4 w-4" strokeWidth={2} />
            {m.logout}
          </button>
        </div>
      </aside>

      <div className="flex flex-col min-h-screen">
        <header className="md:hidden sticky top-0 z-10 border-b border-sand bg-paper-card/95 backdrop-blur px-4 py-3 flex items-center justify-between gap-3">
          <span className="font-display text-xl text-pine-dark">{m.brand}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-sand p-2 text-ink-muted"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <select
              className="max-w-[46vw] rounded-lg border border-sand bg-paper-card px-2 py-1.5 text-sm"
              value={activeOrgId ?? ""}
              onChange={(e) => setActiveOrgId(e.target.value || null)}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8">
          <Outlet />
        </main>
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-10 border-t border-sand bg-paper-card grid grid-cols-5 text-[11px]">
          {[
            { to: "/dashboard", label: m.nav.dashboard, icon: LayoutDashboard },
            { to: "/transactions", label: m.nav.transactions, icon: ArrowLeftRight },
            { to: "/reports", label: m.nav.reports, icon: Building2 },
            { to: "/accounts", label: m.nav.more, icon: BookOpen },
            { to: "/settings", label: m.settings, icon: Settings },
          ].map((l) => {
            const Icon = l.icon;
            return (
              <NavLink
                key={l.to}
                to={l.to}
                className="flex flex-col items-center gap-1 py-2.5 text-ink-muted aria-[current=page]:text-pine aria-[current=page]:font-semibold"
              >
                <Icon className="h-4 w-4" />
                {l.label}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
