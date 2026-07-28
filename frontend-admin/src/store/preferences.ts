import { create } from "zustand";

export type ThemeMode = "light" | "dark";
export type Locale = "id" | "en";

type PreferencesState = {
  theme: ThemeMode;
  locale: Locale;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: Locale) => void;
  hydrate: () => void;
};

const THEME_KEY = "finbiz.admin.theme";
const LOCALE_KEY = "finbiz.admin.locale";

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
}

export const usePreferences = create<PreferencesState>((set) => ({
  theme: "light",
  locale: "id",
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  setLocale: (locale) => {
    localStorage.setItem(LOCALE_KEY, locale);
    applyLocale(locale);
    set({ locale });
  },
  hydrate: () => {
    const theme = (localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? "light";
    const locale = (localStorage.getItem(LOCALE_KEY) as Locale | null) ?? "id";
    applyTheme(theme === "dark" ? "dark" : "light");
    applyLocale(locale === "en" ? "en" : "id");
    set({
      theme: theme === "dark" ? "dark" : "light",
      locale: locale === "en" ? "en" : "id",
    });
  },
}));
