import { useEffect } from "react";
import {
  FileKey,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { t } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import { usePreferences } from "@/store/preferences";

export function AppShell() {
  const { user, logout } = useAuth();
  const { theme, locale, setTheme, hydrate } = usePreferences();
  const navigate = useNavigate();
  const m = t(locale);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const links = [
    { to: "/", label: m.nav.overview, icon: LayoutDashboard, end: true },
    { to: "/users", label: m.nav.users, icon: Users },
    { to: "/plans", label: m.nav.plans, icon: Package },
    { to: "/licenses", label: m.nav.licenses, icon: FileKey },
    { to: "/settings", label: m.nav.settings, icon: Settings },
  ];

  return (
    <div className="min-h-screen md:grid md:grid-cols-[272px_1fr] bg-paper text-ink">
      <aside className="sidebar-panel hidden md:flex flex-col px-3 py-5">
        <div className="px-3 mb-8">
          <div className="font-display text-2xl text-white tracking-tight">{m.brand}</div>
          <p className="text-sm text-white/65 mt-1 truncate">{user?.email}</p>
        </div>
        <nav className="flex flex-col gap-1 flex-1 px-1">
          {links.map((l) => {
            const Icon = l.icon;
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                    isActive
                      ? "sidebar-link-active"
                      : "text-white/80 hover:bg-white/10 hover:text-white",
                  ].join(" ")
                }
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                {l.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-4 space-y-1 border-t border-white/10 pt-4 px-1">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? m.themeLight : m.themeDark}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            <LogOut className="h-4 w-4" />
            {m.logout}
          </button>
        </div>
      </aside>

      <div className="flex flex-col min-h-screen">
        <header className="md:hidden sticky top-0 z-10 border-b border-sand bg-paper-card/95 backdrop-blur px-4 py-3 flex items-center justify-between">
          <span className="font-display text-xl text-pine-dark">{m.brand}</span>
          <button
            type="button"
            className="rounded-lg border border-sand p-2 text-ink-muted"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <nav className="md:hidden flex gap-1 overflow-x-auto border-b border-sand bg-paper-card px-2 py-2 text-xs">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-ink-muted aria-[current=page]:bg-pine aria-[current=page]:text-white"
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
