import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/store/auth";

const links = [
  { to: "/dashboard", label: "Beranda" },
  { to: "/transactions", label: "Transaksi" },
  { to: "/cash", label: "Kas" },
  { to: "/capital", label: "Modal" },
  { to: "/payables", label: "Hutang" },
  { to: "/receivables", label: "Piutang" },
  { to: "/accounts", label: "Bagan akun" },
  { to: "/journals", label: "Jurnal" },
  { to: "/reports", label: "Laporan" },
  { to: "/contacts", label: "Kontak" },
];

export function AppShell() {
  const { user, orgs, activeOrgId, setActiveOrgId, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="hidden md:flex flex-col border-r border-sand bg-paper-card/80 backdrop-blur px-4 py-6">
        <div className="font-display text-2xl text-pine-dark tracking-tight">FinBiz</div>
        <p className="text-sm text-ink-faint mt-1 mb-6">{user?.name}</p>
        <label className="text-xs uppercase tracking-wide text-ink-faint mb-1">Bisnis aktif</label>
        <select
          className="mb-6 w-full rounded border border-sand bg-paper px-2 py-2 text-sm"
          value={activeOrgId ?? ""}
          onChange={(e) => setActiveOrgId(e.target.value || null)}
        >
          {orgs.length === 0 && <option value="">Belum ada bisnis</option>}
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <nav className="flex flex-col gap-1 flex-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `rounded px-3 py-2 text-sm ${isActive ? "bg-pine text-white" : "text-ink-muted hover:bg-sand"}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="mt-4 text-left text-sm text-ink-faint hover:text-pine"
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          Keluar
        </button>
      </aside>

      <div className="flex flex-col min-h-screen">
        <header className="md:hidden sticky top-0 z-10 border-b border-sand bg-paper-card/90 backdrop-blur px-4 py-3 flex items-center justify-between">
          <span className="font-display text-xl text-pine-dark">FinBiz</span>
          <select
            className="max-w-[50%] rounded border border-sand bg-paper px-2 py-1 text-sm"
            value={activeOrgId ?? ""}
            onChange={(e) => setActiveOrgId(e.target.value || null)}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </header>
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8">
          <Outlet />
        </main>
        <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-sand bg-paper-card grid grid-cols-4 text-xs">
          {[
            { to: "/dashboard", label: "Beranda" },
            { to: "/transactions", label: "Transaksi" },
            { to: "/reports", label: "Laporan" },
            { to: "/accounts", label: "Lainnya" },
          ].map((l) => (
            <NavLink key={l.to} to={l.to} className="py-3 text-center text-ink-muted aria-[current=page]:text-pine aria-[current=page]:font-semibold">
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
