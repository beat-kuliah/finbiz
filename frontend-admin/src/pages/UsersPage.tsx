import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiJson } from "@/lib/api";

type PlatformUser = {
  id: string;
  email: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
};

type Plan = { code: string; name: string };

export function UsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [usersRes, plansRes] = await Promise.all([
        apiJson<{ users: PlatformUser[] }>("/api/platform/users"),
        apiJson<{ plans: Plan[] }>("/api/platform/plans"),
      ]);
      setUsers(usersRes.users);
      setPlans(plansRes.plans);
    } catch {
      toast.error("Gagal memuat pengguna");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function extendTrial(userId: string) {
    const daysStr = window.prompt("Perpanjang trial (hari):", "30");
    if (!daysStr) return;
    const days = Number.parseInt(daysStr, 10);
    if (!Number.isFinite(days) || days <= 0) {
      toast.error("Jumlah hari tidak valid");
      return;
    }
    setBusyId(userId);
    try {
      await apiJson(`/api/platform/users/${userId}/extend-trial`, {
        method: "POST",
        body: JSON.stringify({ days }),
      });
      toast.success("Trial diperpanjang");
      await load();
    } catch {
      toast.error("Gagal memperpanjang trial");
    } finally {
      setBusyId(null);
    }
  }

  async function setPlan(userId: string, planCode: string) {
    if (!planCode) return;
    setBusyId(userId);
    try {
      await apiJson(`/api/platform/users/${userId}/set-plan`, {
        method: "POST",
        body: JSON.stringify({ planCode }),
      });
      toast.success("Paket diperbarui");
      await load();
    } catch {
      toast.error("Gagal mengubah paket");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-ink-muted">Memuat…</p>;
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-pine-dark mb-6">Pengguna</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sand text-left text-ink-faint">
              <th className="pb-2 pr-4 font-medium">Nama</th>
              <th className="pb-2 pr-4 font-medium">Email</th>
              <th className="pb-2 pr-4 font-medium">Paket</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 pr-4 font-medium">Trial berakhir</th>
              <th className="pb-2 font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-sand/60 last:border-0">
                <td className="py-3 pr-4">{u.name}</td>
                <td className="py-3 pr-4">{u.email}</td>
                <td className="py-3 pr-4">{u.plan}</td>
                <td className="py-3 pr-4">{u.subscriptionStatus}</td>
                <td className="py-3 pr-4">
                  {u.trialEndsAt ? new Date(u.trialEndsAt).toLocaleDateString("id-ID") : "—"}
                </td>
                <td className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      disabled={busyId === u.id}
                      onClick={() => void extendTrial(u.id)}
                    >
                      Perpanjang trial
                    </button>
                    <select
                      className="field-input w-auto min-w-[120px] py-1"
                      defaultValue=""
                      disabled={busyId === u.id}
                      onChange={(e) => {
                        const code = e.target.value;
                        e.target.value = "";
                        if (code) void setPlan(u.id, code);
                      }}
                    >
                      <option value="">Ubah paket…</option>
                      {plans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="text-ink-faint py-4">Belum ada pengguna.</p>}
      </div>
    </div>
  );
}
