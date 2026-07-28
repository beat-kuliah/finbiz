import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ApiError, apiJson, formatIDR } from "@/lib/api";
import { useAuth } from "@/store/auth";

export function OnboardingPage() {
  const { orgs, loadOrgs, setActiveOrgId, status } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("umkm");
  const [openingCash, setOpeningCash] = useState("0");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && orgs.length > 0) {
      navigate("/dashboard", { replace: true });
    }
  }, [orgs, status, navigate]);

  if (status === "unauthenticated") return <Navigate to="/login" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const cash = Math.round(Number(openingCash.replace(/\D/g, "")) || 0);
      const res = await apiJson<{ organization: { id: string } }>("/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name, businessType, openingCash: cash }),
      });
      await loadOrgs();
      setActiveOrgId(res.organization.id);
      toast.success("Bisnis siap");
      navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal membuat bisnis");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-lg bg-paper-card border border-sand rounded-lg p-8">
        <h1 className="font-display text-3xl text-pine-dark mb-2">Onboarding bisnis</h1>
        <p className="text-ink-faint mb-6">Kami akan seed bagan akun UMKM standar Indonesia.</p>
        <label className="block text-sm mb-1">Nama bisnis / PT</label>
        <input className="w-full mb-4 rounded border border-sand px-3 py-2" required value={name} onChange={(e) => setName(e.target.value)} />
        <label className="block text-sm mb-1">Jenis usaha</label>
        <select className="w-full mb-4 rounded border border-sand px-3 py-2" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
          <option value="umkm">UMKM umum</option>
          <option value="dagang">Dagang</option>
          <option value="jasa">Jasa</option>
        </select>
        <label className="block text-sm mb-1">Saldo kas awal (opsional, rupiah)</label>
        <input className="w-full mb-6 rounded border border-sand px-3 py-2" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
        <button disabled={busy} className="w-full bg-pine text-white rounded py-2.5 font-medium">
          {busy ? "Menyiapkan…" : "Selesai"}
        </button>
      </form>
    </div>
  );
}

export function DashboardPage() {
  const { activeOrgId, orgs, loadOrgs } = useAuth();
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [consol, setConsol] = useState<{
    organizations: { name: string; cash: number; revenue: number; netIncome: number }[];
    totals: { cash: number; revenue: number; netIncome: number };
  } | null>(null);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    if (!activeOrgId) return;
    void apiJson<Record<string, number>>("/api/dashboard", {}, activeOrgId).then(setSummary).catch(() => setSummary(null));
  }, [activeOrgId]);

  useEffect(() => {
    void apiJson<typeof consol>("/api/dashboard/consolidated")
      .then(setConsol)
      .catch(() => setConsol(null));
  }, []);

  if (!activeOrgId) {
    return (
      <div>
        <h1 className="font-display text-3xl mb-2">Dashboard</h1>
        <p className="text-ink-muted mb-4">Belum ada bisnis. Buat yang pertama.</p>
        <a href="/onboarding" className="text-pine font-medium">
          Onboarding →
        </a>
      </div>
    );
  }

  const orgName = orgs.find((o) => o.id === activeOrgId)?.name ?? "Bisnis";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink">{orgName}</h1>
        <p className="text-ink-faint">Ringkasan periode berjalan</p>
      </div>
      {summary && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            ["Kas bersih", summary.cash],
            ["Pendapatan periode", summary.periodRevenue],
            ["Laba bersih periode", summary.periodNetIncome],
            ["Piutang", summary.receivables],
            ["Hutang", summary.payables],
            ["Ekuitas", summary.equity],
          ].map(([label, val]) => (
            <div key={String(label)} className="bg-paper-card border border-sand rounded-lg p-4">
              <div className="text-sm text-ink-faint">{label}</div>
              <div className="text-xl font-semibold mt-1">{formatIDR(Number(val) || 0)}</div>
            </div>
          ))}
        </div>
      )}
      {consol && consol.organizations.length > 1 && (
        <section>
          <h2 className="font-display text-2xl mb-3">Agregat semua PT (owner)</h2>
          <div className="grid sm:grid-cols-3 gap-4 mb-4">
            <div className="bg-pine/10 rounded-lg p-4">
              <div className="text-sm">Total kas</div>
              <div className="text-lg font-semibold">{formatIDR(consol.totals.cash)}</div>
            </div>
            <div className="bg-pine/10 rounded-lg p-4">
              <div className="text-sm">Total pendapatan</div>
              <div className="text-lg font-semibold">{formatIDR(consol.totals.revenue)}</div>
            </div>
            <div className="bg-pine/10 rounded-lg p-4">
              <div className="text-sm">Total laba</div>
              <div className="text-lg font-semibold">{formatIDR(consol.totals.netIncome)}</div>
            </div>
          </div>
          <ul className="text-sm space-y-1 text-ink-muted">
            {consol.organizations.map((o) => (
              <li key={o.name}>
                {o.name}: kas {formatIDR(o.cash)} · pendapatan {formatIDR(o.revenue)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
