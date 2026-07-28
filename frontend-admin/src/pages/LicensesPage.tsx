import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { apiJson } from "@/lib/api";

type Plan = { code: string; name: string };

type LicenseResult = {
  id: string;
  key: string;
  planCode: string;
  maxOrgs: number;
  maxSeats: number;
  issuedTo: string | null;
  expiresAt: string | null;
};

export function LicensesPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState("");
  const [seats, setSeats] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<LicenseResult | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiJson<{ plans: Plan[] }>("/api/platform/plans");
        setPlans(res.plans);
        if (res.plans[0]) setTier(res.plans[0].code);
      } catch {
        toast.error("Gagal memuat paket");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tier) {
      toast.error("Pilih tier paket");
      return;
    }
    setSubmitting(true);
    setCreated(null);
    try {
      const body: Record<string, unknown> = { tier };
      if (email) body.email = email;
      if (seats) body.seats = Number.parseInt(seats, 10);
      if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();

      const res = await apiJson<{ license: LicenseResult }>("/api/platform/licenses", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCreated(res.license);
      toast.success("Lisensi dibuat");
    } catch {
      toast.error("Gagal membuat lisensi");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-ink-muted">Memuat…</p>;
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-pine-dark mb-6">Lisensi</h1>
      <form className="card max-w-lg space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <div>
          <label className="block text-sm text-ink-faint mb-1" htmlFor="tier">
            Tier paket
          </label>
          <select
            id="tier"
            className="field-input"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            required
          >
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-ink-faint mb-1" htmlFor="email">
            Email penerima (opsional)
          </label>
          <input
            id="email"
            type="email"
            className="field-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-ink-faint mb-1" htmlFor="seats">
            Kursi (opsional)
          </label>
          <input
            id="seats"
            type="number"
            min={1}
            className="field-input"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-ink-faint mb-1" htmlFor="expiresAt">
            Kedaluwarsa (opsional)
          </label>
          <input
            id="expiresAt"
            type="datetime-local"
            className="field-input"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Membuat…" : "Buat lisensi"}
        </button>
      </form>

      {created && (
        <div className="card max-w-lg mt-6 space-y-2">
          <h2 className="font-medium text-ink">Lisensi baru</h2>
          <p className="text-sm break-all">
            <span className="text-ink-faint">Kunci: </span>
            <code className="text-pine-dark">{created.key}</code>
          </p>
          <p className="text-sm">
            <span className="text-ink-faint">Paket: </span>
            {created.planCode}
          </p>
          <p className="text-sm">
            <span className="text-ink-faint">Kursi: </span>
            {created.maxSeats}
          </p>
          {created.issuedTo && (
            <p className="text-sm">
              <span className="text-ink-faint">Diterbitkan ke: </span>
              {created.issuedTo}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
