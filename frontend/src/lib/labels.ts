const DOC_KIND: Record<string, string> = {
  cash_in: "Kas masuk",
  cash_out: "Kas keluar",
  transfer: "Transfer",
  capital: "Modal",
  loan_in: "Terima hutang",
  loan_payment: "Bayar hutang",
  invoice: "Invoice",
  receipt: "Pelunasan",
};

const DOC_STATUS: Record<string, string> = {
  posted: "Diposting",
  voided: "Dibatalkan",
  draft: "Draf",
};

const ACCOUNT_TYPE: Record<string, string> = {
  asset: "Aset",
  liability: "Kewajiban",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  expense: "Beban",
};

const CONTACT_KIND: Record<string, string> = {
  customer: "Pelanggan",
  vendor: "Supplier",
  lender: "Pemberi pinjaman",
  other: "Lainnya",
};

const SUBSCRIPTION_STATUS: Record<string, string> = {
  trial: "Trial",
  active: "Aktif",
  past_due: "Tertunggak",
  canceled: "Dibatalkan",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
  inactive: "Tidak aktif",
};

const OPEN_ITEM_STATUS: Record<string, string> = {
  open: "Terbuka",
  closed: "Lunas",
  partial: "Sebagian",
};

export function docKindLabel(kind: string): string {
  return DOC_KIND[kind] ?? kind;
}

export function docStatusLabel(status: string): string {
  return DOC_STATUS[status] ?? status;
}

export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPE[type] ?? type;
}

export function contactKindLabel(kind: string): string {
  return CONTACT_KIND[kind] ?? kind;
}

export function subscriptionStatusLabel(status: string): string {
  return SUBSCRIPTION_STATUS[status] ?? status;
}

export function openItemStatusLabel(status: string): string {
  return OPEN_ITEM_STATUS[status] ?? status;
}

export function formatDateID(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
