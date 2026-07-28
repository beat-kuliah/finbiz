import type { Locale } from "@/store/preferences";

const dict = {
  id: {
    brand: "FinBiz",
    activeBusiness: "Bisnis aktif",
    noBusiness: "Belum ada bisnis",
    logout: "Keluar",
    settings: "Pengaturan",
    theme: "Tema",
    themeLight: "Terang",
    themeDark: "Gelap",
    language: "Bahasa",
    languageId: "Indonesia",
    languageEn: "English",
    settingsTitle: "Pengaturan tampilan",
    settingsHint: "Sesuaikan tema dan bahasa antarmuka.",
    nav: {
      dashboard: "Beranda",
      transactions: "Transaksi",
      cash: "Kas",
      capital: "Modal",
      payables: "Hutang",
      receivables: "Piutang",
      accounts: "Bagan akun",
      assets: "Aset tetap",
      journals: "Jurnal",
      reports: "Laporan",
      contacts: "Kontak",
      billing: "Langganan",
      more: "Lainnya",
    },
    groups: {
      operasi: "Operasi",
      keuangan: "Keuangan",
      laporan: "Laporan & akun",
      akun: "Akun",
    },
  },
  en: {
    brand: "FinBiz",
    activeBusiness: "Active business",
    noBusiness: "No business yet",
    logout: "Sign out",
    settings: "Settings",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    language: "Language",
    languageId: "Indonesian",
    languageEn: "English",
    settingsTitle: "Display settings",
    settingsHint: "Adjust interface theme and language.",
    nav: {
      dashboard: "Home",
      transactions: "Transactions",
      cash: "Cash",
      capital: "Capital",
      payables: "Payables",
      receivables: "Receivables",
      accounts: "Chart of accounts",
      assets: "Fixed assets",
      journals: "Journals",
      reports: "Reports",
      contacts: "Contacts",
      billing: "Billing",
      more: "More",
    },
    groups: {
      operasi: "Operations",
      keuangan: "Finance",
      laporan: "Reports & accounts",
      akun: "Account",
    },
  },
} as const;

export type Messages = {
  brand: string;
  activeBusiness: string;
  noBusiness: string;
  logout: string;
  settings: string;
  theme: string;
  themeLight: string;
  themeDark: string;
  language: string;
  languageId: string;
  languageEn: string;
  settingsTitle: string;
  settingsHint: string;
  nav: Record<keyof (typeof dict)["id"]["nav"], string>;
  groups: Record<keyof (typeof dict)["id"]["groups"], string>;
};

export function t(locale: Locale): Messages {
  return dict[locale];
}
