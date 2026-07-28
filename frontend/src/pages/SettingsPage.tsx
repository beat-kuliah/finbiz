import { useEffect } from "react";
import { t } from "@/lib/i18n";
import { usePreferences, type Locale, type ThemeMode } from "@/store/preferences";

export function SettingsPage() {
  const { theme, locale, setTheme, setLocale, hydrate } = usePreferences();
  const m = t(locale);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink">{m.settingsTitle}</h1>
        <p className="text-ink-muted mt-1">{m.settingsHint}</p>
      </div>

      <section className="rounded-xl border border-sand bg-paper-card p-5 space-y-3">
        <h2 className="font-semibold text-ink">{m.theme}</h2>
        <div className="grid grid-cols-2 gap-3">
          {([
            ["light", m.themeLight],
            ["dark", m.themeDark],
          ] as [ThemeMode, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={[
                "rounded-lg border px-4 py-3 text-sm font-medium transition",
                theme === value
                  ? "border-pine bg-pine text-white"
                  : "border-sand bg-paper text-ink-muted hover:border-pine/40",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-sand bg-paper-card p-5 space-y-3">
        <h2 className="font-semibold text-ink">{m.language}</h2>
        <div className="grid grid-cols-2 gap-3">
          {([
            ["id", m.languageId],
            ["en", m.languageEn],
          ] as [Locale, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setLocale(value)}
              className={[
                "rounded-lg border px-4 py-3 text-sm font-medium transition",
                locale === value
                  ? "border-pine bg-pine text-white"
                  : "border-sand bg-paper text-ink-muted hover:border-pine/40",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
