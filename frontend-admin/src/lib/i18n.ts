import type { Locale } from "@/store/preferences";

const dict = {
  id: {
    brand: "FinBiz Admin",
    logout: "Keluar",
    theme: "Tema",
    themeLight: "Terang",
    themeDark: "Gelap",
    language: "Bahasa",
    languageId: "Indonesia",
    languageEn: "English",
    displaySection: "Tampilan",
    displayHint: "Tema dan bahasa panel admin.",
    nav: {
      overview: "Ringkasan",
      users: "Pengguna",
      plans: "Paket",
      licenses: "Lisensi",
      settings: "Pengaturan",
    },
  },
  en: {
    brand: "FinBiz Admin",
    logout: "Sign out",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    language: "Language",
    languageId: "Indonesian",
    languageEn: "English",
    displaySection: "Display",
    displayHint: "Admin panel theme and language.",
    nav: {
      overview: "Overview",
      users: "Users",
      plans: "Plans",
      licenses: "Licenses",
      settings: "Settings",
    },
  },
} as const;

export type Messages = {
  brand: string;
  logout: string;
  theme: string;
  themeLight: string;
  themeDark: string;
  language: string;
  languageId: string;
  languageEn: string;
  displaySection: string;
  displayHint: string;
  nav: Record<keyof (typeof dict)["id"]["nav"], string>;
};

export function t(locale: Locale): Messages {
  return dict[locale];
}
