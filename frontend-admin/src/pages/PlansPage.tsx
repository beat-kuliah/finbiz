import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { apiJson, formatIDR } from "@/lib/api";

type Plan = {
  code: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  maxOrgs: number;
  maxSeats: number;
  features: Record<string, unknown>;
  active: boolean;
};

type EditState = {
  name: string;
  priceMonthly: string;
  priceYearly: string;
  maxOrgs: string;
  maxSeats: string;
  active: boolean;
};

function toEditState(plan: Plan): EditState {
  return {
    name: plan.name,
    priceMonthly: String(plan.priceMonthly),
    priceYearly: String(plan.priceYearly),
    maxOrgs: String(plan.maxOrgs),
    maxSeats: String(plan.maxSeats),
    active: plan.active,
  };
}

export function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<Record<string, EditState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiJson<{ plans: Plan[] }>("/api/platform/plans");
      setPlans(res.plans);
      const next: Record<string, EditState> = {};
      for (const p of res.plans) next[p.code] = toEditState(p);
      setEditing(next);
    } catch {
      toast.error("Gagal memuat paket");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateField(code: string, field: keyof EditState, value: string | boolean) {
    setEditing((prev) => ({
      ...prev,
      [code]: { ...prev[code]!, [field]: value },
    }));
  }

  async function savePlan(e: FormEvent, code: string) {
    e.preventDefault();
    const form = editing[code];
    if (!form) return;
    setSaving(code);
    try {
      await apiJson(`/api/platform/plans/${code}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name,
          priceMonthly: Number(form.priceMonthly),
          priceYearly: Number(form.priceYearly),
          maxOrgs: Number.parseInt(form.maxOrgs, 10),
          maxSeats: Number.parseInt(form.maxSeats, 10),
          features: plans.find((p) => p.code === code)?.features ?? {},
          active: form.active,
        }),
      });
      toast.success(`Paket ${code} disimpan`);
      await load();
    } catch {
      toast.error("Gagal menyimpan paket");
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <p className="text-ink-muted">Memuat…</p>;
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-pine-dark mb-6">Paket</h1>
      <div className="space-y-6">
        {plans.map((plan) => {
          const form = editing[plan.code];
          if (!form) return null;
          return (
            <form key={plan.code} className="card space-y-4" onSubmit={(e) => void savePlan(e, plan.code)}>
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-medium text-lg text-ink">{plan.code}</h2>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => updateField(plan.code, "active", e.target.checked)}
                  />
                  Aktif
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-ink-faint mb-1">Nama</label>
                  <input
                    className="field-input"
                    value={form.name}
                    onChange={(e) => updateField(plan.code, "name", e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-ink-faint mb-1">Harga bulanan (IDR)</label>
                  <input
                    className="field-input"
                    type="number"
                    min={0}
                    value={form.priceMonthly}
                    onChange={(e) => updateField(plan.code, "priceMonthly", e.target.value)}
                    required
                  />
                  <p className="text-xs text-ink-faint mt-1">{formatIDR(Number(form.priceMonthly) || 0)}</p>
                </div>
                <div>
                  <label className="block text-sm text-ink-faint mb-1">Harga tahunan (IDR)</label>
                  <input
                    className="field-input"
                    type="number"
                    min={0}
                    value={form.priceYearly}
                    onChange={(e) => updateField(plan.code, "priceYearly", e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-ink-faint mb-1">Maks. bisnis</label>
                  <input
                    className="field-input"
                    type="number"
                    min={1}
                    value={form.maxOrgs}
                    onChange={(e) => updateField(plan.code, "maxOrgs", e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-ink-faint mb-1">Maks. kursi</label>
                  <input
                    className="field-input"
                    type="number"
                    min={1}
                    value={form.maxSeats}
                    onChange={(e) => updateField(plan.code, "maxSeats", e.target.value)}
                    required
                  />
                </div>
              </div>
              <button type="submit" className="btn-primary" disabled={saving === plan.code}>
                {saving === plan.code ? "Menyimpan…" : "Simpan"}
              </button>
            </form>
          );
        })}
        {plans.length === 0 && <p className="text-ink-faint">Belum ada paket.</p>}
      </div>
    </div>
  );
}
