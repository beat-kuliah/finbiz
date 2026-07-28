import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { apiJson } from "@/lib/api";
import { t } from "@/lib/i18n";
import { usePreferences, type Locale, type ThemeMode } from "@/store/preferences";

export function SettingsPage() {
  const { theme, locale, setTheme, setLocale, hydrate } = usePreferences();
  const m = t(locale);
  const [trialDays, setTrialDays] = useState("90");
  const [testEmail, setTestEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiJson<{ settings: { trial_days?: number } }>("/api/platform/settings");
        const days = res.settings.trial_days;
        if (typeof days === "number") setTrialDays(String(days));
      } catch {
        toast.error("Gagal memuat pengaturan");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    const days = Number.parseInt(trialDays, 10);
    if (!Number.isFinite(days) || days <= 0) {
      toast.error("Jumlah hari trial tidak valid");
      return;
    }
    setSaving(true);
    try {
      const res = await apiJson<{ settings: { trial_days: number } }>("/api/platform/settings", {
        method: "PUT",
        body: JSON.stringify({ trial_days: days }),
      });
      setTrialDays(String(res.settings.trial_days));
      toast.success("Pengaturan disimpan");
    } catch {
      toast.error("Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  }

  async function sendTestEmail() {
    if (!testEmail) {
      toast.error("Masukkan alamat email");
      return;
    }
    setSending(true);
    try {
      await apiJson("/api/platform/settings/test-email", {
        method: "POST",
        body: JSON.stringify({ to: testEmail }),
      });
      toast.success("Email uji terkirim");
    } catch {
      toast.error("Gagal mengirim email uji");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <p className="text-ink-muted">Memuat…</p>;
  }

  return (
    <div>
      <h1 className="font-display text-2xl text-pine-dark mb-6">{m.nav.settings}</h1>
      <div className="space-y-6 max-w-lg">
        <section className="card space-y-4">
          <div>
            <h2 className="font-medium text-ink">{m.displaySection}</h2>
            <p className="text-sm text-ink-faint mt-1">{m.displayHint}</p>
          </div>
          <div>
            <div className="text-sm text-ink-faint mb-2">{m.theme}</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["light", m.themeLight],
                ["dark", m.themeDark],
              ] as [ThemeMode, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={[
                    "rounded-lg border px-3 py-2 text-sm font-medium",
                    theme === value ? "border-pine bg-pine text-white" : "border-sand text-ink-muted",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm text-ink-faint mb-2">{m.language}</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["id", m.languageId],
                ["en", m.languageEn],
              ] as [Locale, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLocale(value)}
                  className={[
                    "rounded-lg border px-3 py-2 text-sm font-medium",
                    locale === value ? "border-pine bg-pine text-white" : "border-sand text-ink-muted",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <form className="card space-y-4" onSubmit={(e) => void saveSettings(e)}>
          <h2 className="font-medium text-ink">Trial</h2>
          <div>
            <label className="block text-sm text-ink-faint mb-1" htmlFor="trialDays">
              Hari trial default
            </label>
            <input
              id="trialDays"
              type="number"
              min={1}
              className="field-input"
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </form>

        <div className="card space-y-4">
          <h2 className="font-medium text-ink">Email uji</h2>
          <div>
            <label className="block text-sm text-ink-faint mb-1" htmlFor="testEmail">
              Kirim ke
            </label>
            <input
              id="testEmail"
              type="email"
              className="field-input"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="admin@example.com"
            />
          </div>
          <button type="button" className="btn-secondary" disabled={sending} onClick={() => void sendTestEmail()}>
            {sending ? "Mengirim…" : "Kirim email uji"}
          </button>
        </div>
      </div>
    </div>
  );
}
