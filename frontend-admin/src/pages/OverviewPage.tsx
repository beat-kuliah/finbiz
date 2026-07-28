import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiJson } from "@/lib/api";

type Overview = {
  users: number;
  subscriptions: number;
  billingEvents: number;
  licenses: number;
  trialDays: number;
};

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiJson<Overview>("/api/platform/overview");
        setData(res);
      } catch {
        toast.error("Gagal memuat ringkasan");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <p className="text-ink-muted">Memuat…</p>;
  }

  const stats = [
    { label: "Pengguna", value: data?.users ?? 0 },
    { label: "Langganan", value: data?.subscriptions ?? 0 },
    { label: "Event billing", value: data?.billingEvents ?? 0 },
    { label: "Lisensi", value: data?.licenses ?? 0 },
    { label: "Hari trial default", value: data?.trialDays ?? 0 },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl text-pine-dark mb-6">Ringkasan</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <p className="text-sm text-ink-faint">{s.label}</p>
            <p className="mt-1 text-3xl font-semibold text-ink">{s.value.toLocaleString("id-ID")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
