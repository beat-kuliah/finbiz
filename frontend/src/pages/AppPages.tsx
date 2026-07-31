import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { DataRow, DataTable, Td } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FilterBar, TextInput, TextSelect } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ApiError, apiJson, formatIDR } from "@/lib/api";
import {
  accountTypeLabel,
  contactKindLabel,
  docKindLabel,
  formatDateID,
  openItemStatusLabel,
  subscriptionStatusLabel,
} from "@/lib/labels";
import { useAuth } from "@/store/auth";

type Account = { id: string; code: string; name: string; type: string; isCash: boolean; balance?: number };
type Doc = {
  id: string;
  kind: string;
  status: string;
  date: string;
  dueDate?: string | null;
  number?: string;
  amount: number;
  memo: string;
  contactId?: string | null;
  isMonthly?: boolean;
};
type OpenItem = {
  id: string;
  description: string;
  originalAmount: number;
  balanceAmount: number;
  dueDate: string | null;
  status: string;
  contactId?: string | null;
  documentId?: string | null;
  documentNumber?: string | null;
  isMonthly?: boolean;
};
type Contact = {
  id: string;
  name: string;
  kind: string;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  address?: string | null;
};

const ARAP_ENDPOINTS: Record<string, string> = {
  invoice: "/api/invoice",
  receipt: "/api/receipt",
  loan_in: "/api/loan-in",
  loan_payment: "/api/loan-payment",
};
type JournalLine = {
  id: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string | null;
};
type Asset = {
  id: string;
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
};

const CASH_KINDS = new Set(["cash_in", "cash_out", "transfer"]);
const dangerBtn =
  "text-sm text-red-600 dark:text-red-400 border border-red-500/30 rounded px-3 py-1 hover:bg-red-500/10 disabled:opacity-50";
const warnBox =
  "text-sm text-amber-700 dark:text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded-lg p-3";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStartISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function inDateRange(date: string, from: string, to: string) {
  const d = String(date).slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function useOrgId() {
  return useAuth((s) => s.activeOrgId);
}

function DocHistoryTable({ docs, empty }: { docs: Doc[]; empty: string }) {
  if (docs.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <DataTable
      headers={[
        { label: "No." },
        { label: "Tanggal" },
        { label: "Jenis" },
        { label: "Keterangan" },
        { label: "Status" },
        { label: "Nominal", align: "right" },
        { label: "", align: "right" },
      ]}
    >
      {docs.map((d) => (
        <DataRow key={d.id}>
          <Td className="font-mono text-xs">{d.number || "—"}</Td>
          <Td>{formatDateID(d.date)}</Td>
          <Td>
            {docKindLabel(d.kind)}
            {d.isMonthly ? <span className="ml-1 text-xs text-pine">· bulanan</span> : null}
          </Td>
          <Td>{d.memo || "—"}</Td>
          <Td>
            <StatusBadge status={d.status} />
          </Td>
          <Td align="right" className="font-medium">
            {formatIDR(d.amount)}
          </Td>
          <Td align="right">
            {d.kind === "invoice" ? (
              <Link
                to={`/invoices/${d.id}/print`}
                target="_blank"
                className="text-sm text-pine hover:underline"
              >
                Cetak
              </Link>
            ) : null}
          </Td>
        </DataRow>
      ))}
    </DataTable>
  );
}

function DocListFilters({
  docs,
  kindOptions,
  empty,
}: {
  docs: Doc[];
  kindOptions?: { value: string; label: string }[];
  empty: string;
}) {
  const [kind, setKind] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return docs.filter((d) => {
      if (kind !== "all" && d.kind !== kind) return false;
      if (!inDateRange(d.date, from, to)) return false;
      if (query && !(d.memo || "").toLowerCase().includes(query) && !docKindLabel(d.kind).toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [docs, kind, from, to, q]);

  return (
    <div className="space-y-3">
      <FilterBar>
        {kindOptions && kindOptions.length > 0 && (
          <Field label="Jenis" className="min-w-[10rem]">
            <TextSelect value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">Semua</option>
              {kindOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </TextSelect>
          </Field>
        )}
        <Field label="Dari" className="min-w-[10rem]">
          <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Sampai" className="min-w-[10rem]">
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Cari" className="min-w-[14rem] flex-1">
          <TextInput placeholder="Keterangan…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
      </FilterBar>
      <DocHistoryTable
        docs={filtered}
        empty={docs.length === 0 ? empty : "Tidak ada data yang cocok dengan filter."}
      />
    </div>
  );
}

function OpenItemsTable({
  items,
  empty,
  showActions,
  onComplete,
}: {
  items: OpenItem[];
  empty: string;
  showActions?: boolean;
  onComplete?: (item: OpenItem) => void;
}) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <DataTable
      headers={[
        { label: "No. invoice" },
        { label: "Deskripsi" },
        { label: "Jatuh tempo" },
        { label: "Status" },
        { label: "Sisa", align: "right" },
        ...(showActions ? [{ label: "", align: "right" as const }] : []),
      ]}
    >
      {items.map((i) => (
        <DataRow key={i.id}>
          <Td className="font-mono text-xs">{i.documentNumber || "—"}</Td>
          <Td>
            {i.description || "—"}
            {i.isMonthly ? <span className="ml-1 text-xs text-pine">· bulanan</span> : null}
          </Td>
          <Td>{formatDateID(i.dueDate)}</Td>
          <Td>
            <StatusBadge status={i.status} variant="openItem" label={openItemStatusLabel(i.status)} />
          </Td>
          <Td align="right" className="font-medium">
            {formatIDR(i.balanceAmount)}
          </Td>
          {showActions ? (
            <Td align="right">
              <div className="flex flex-wrap justify-end gap-2">
                {i.documentId ? (
                  <Link
                    to={`/invoices/${i.documentId}/print`}
                    target="_blank"
                    className="text-sm text-pine hover:underline"
                  >
                    Cetak
                  </Link>
                ) : null}
                {onComplete ? (
                  <button
                    type="button"
                    className="text-sm text-pine border border-pine/30 rounded px-2.5 py-1 hover:bg-pine/10"
                    onClick={() => onComplete(i)}
                  >
                    Lunasi
                  </button>
                ) : null}
              </div>
            </Td>
          ) : null}
        </DataRow>
      ))}
    </DataTable>
  );
}

function CompletePaymentDialog({
  item,
  onClose,
  onSaved,
}: {
  item: OpenItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const orgId = useOrgId();
  const [date, setDate] = useState(todayISO);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    try {
      const res = await apiJson<{ document: { nextInvoiceId?: string } }>(
        "/api/receipt/complete",
        {
          method: "POST",
          body: JSON.stringify({
            openItemId: item.id,
            date,
            memo: memo || `Pelunasan ${item.documentNumber || item.description || ""}`.trim(),
          }),
        },
        orgId,
      );
      if (res.document?.nextInvoiceId) {
        toast.success("Lunas. Invoice bulanan berikutnya sudah dibuat.");
      } else {
        toast.success("Pembayaran lunas tersimpan");
      }
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal melunasi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog">
      <div className="w-full max-w-md rounded-lg border border-sand bg-paper-card p-5 shadow-lg space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-lg">Complete payment</h2>
            <p className="text-sm text-ink-muted mt-1">
              Lunasi sisa {formatIDR(item.balanceAmount)}
              {item.isMonthly ? " · akan membuat invoice bulan berikutnya" : ""}
            </p>
          </div>
          <button type="button" className="text-ink-faint hover:text-ink text-sm" onClick={onClose}>
            Tutup
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Tanggal pembayaran">
            <TextInput type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Keterangan">
            <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Opsional" />
          </Field>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg border border-sand px-4 py-2.5 text-sm"
              onClick={onClose}
              disabled={busy}
            >
              Batal
            </button>
            <button
              className="flex-1 bg-pine text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              disabled={busy}
            >
              {busy ? "Menyimpan…" : "Lunasi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReportLine({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 ${strong ? "font-semibold border-t border-sand mt-2 pt-2" : ""}`}>
      <span className={strong ? "" : "text-ink-muted"}>{label}</span>
      <span>{formatIDR(value)}</span>
    </div>
  );
}

export function TransactionsPage() {
  const orgId = useOrgId();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [kind, setKind] = useState("cash_in");
  const [date, setDate] = useState(todayISO);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cashId, setCashId] = useState("");
  const [counterId, setCounterId] = useState("");

  async function reload() {
    if (!orgId) return;
    const [d, a] = await Promise.all([
      apiJson<{ documents: Doc[] }>("/api/documents", {}, orgId),
      apiJson<{ accounts: Account[] }>("/api/accounts", {}, orgId),
    ]);
    setDocs((d.documents ?? []).filter((x) => CASH_KINDS.has(x.kind)));
    setAccounts(a.accounts ?? []);
    const cashAccounts = a.accounts?.filter((x) => x.isCash) ?? [];
    const cash = cashAccounts[0];
    const rev = a.accounts?.find((x) => x.type === "revenue");
    const exp = a.accounts?.find((x) => x.type === "expense");
    if (kind === "transfer") {
      if (cash) setCashId(cash.id);
      const dest = cashAccounts.find((x) => x.id !== cash?.id) ?? cashAccounts[1];
      if (dest) setCounterId(dest.id);
    } else {
      if (cash) setCashId(cash.id);
      if (kind === "cash_in" && rev) setCounterId(rev.id);
      if (kind === "cash_out" && exp) setCounterId(exp.id);
    }
  }

  useEffect(() => {
    void reload().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, kind]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    try {
      const amt = Math.round(Number(amount.replace(/\D/g, "")) || 0);
      await apiJson(
        "/api/documents",
        {
          method: "POST",
          body: JSON.stringify({
            kind,
            amount: amt,
            memo,
            cashAccountId: cashId || undefined,
            counterAccountId: counterId || undefined,
            date,
          }),
        },
        orgId,
      );
      toast.success("Transaksi tercatat & jurnal diposting");
      setAmount("");
      setMemo("");
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menyimpan");
    }
  }

  if (!orgId) return <p className="text-ink-muted">Pilih bisnis dulu.</p>;

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl">Transaksi</h1>
      <form onSubmit={onSubmit} className="bg-paper-card border border-sand rounded-lg p-5 space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Jenis">
            <TextSelect value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="cash_in">Kas masuk</option>
              <option value="cash_out">Kas keluar</option>
              <option value="transfer">Transfer</option>
            </TextSelect>
          </Field>
          <Field label="Tanggal">
            <TextInput type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Nominal">
            <TextInput required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </Field>
        </div>
        <Field label="Keterangan">
          <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Contoh: pembayaran klien" />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          {kind === "transfer" ? (
            <>
              <Field label="Akun kas sumber">
                <TextSelect value={cashId} onChange={(e) => setCashId(e.target.value)}>
                  {accounts.filter((a) => a.isCash).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </TextSelect>
              </Field>
              <Field label="Akun kas tujuan">
                <TextSelect value={counterId} onChange={(e) => setCounterId(e.target.value)}>
                  {accounts.filter((a) => a.isCash).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </TextSelect>
              </Field>
            </>
          ) : (
            <>
              <Field label="Akun kas/bank">
                <TextSelect value={cashId} onChange={(e) => setCashId(e.target.value)}>
                  {accounts.filter((a) => a.isCash).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </TextSelect>
              </Field>
              <Field label="Akun lawan">
                <TextSelect value={counterId} onChange={(e) => setCounterId(e.target.value)}>
                  {accounts.filter((a) => !a.isCash).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </TextSelect>
              </Field>
            </>
          )}
        </div>
        <button className="bg-pine text-white rounded-lg px-5 py-2.5 text-sm font-medium">Simpan</button>
      </form>
      <section className="space-y-3">
        <h2 className="font-semibold">Riwayat transaksi kas</h2>
        <DocListFilters
          docs={docs}
          empty="Belum ada transaksi kas."
          kindOptions={[
            { value: "cash_in", label: "Kas masuk" },
            { value: "cash_out", label: "Kas keluar" },
            { value: "transfer", label: "Transfer" },
          ]}
        />
      </section>
    </div>
  );
}

function SimpleDocForm({
  title,
  kind,
  defaults,
  openItems,
  requiresOpenItem,
  contacts,
  contactId: lockedContactId,
  lockContact,
  onSaved,
}: {
  title: string;
  kind: string;
  defaults?: Partial<{ isPrive: boolean }>;
  openItems?: OpenItem[];
  requiresOpenItem?: boolean;
  contacts?: Contact[];
  contactId?: string;
  lockContact?: boolean;
  onSaved?: () => Promise<void>;
}) {
  const orgId = useOrgId();
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(todayISO);
  const [dueDate, setDueDate] = useState(() => plusDaysISO(14));
  const [isMonthly, setIsMonthly] = useState(false);
  const [openItemId, setOpenItemId] = useState("");
  const [contactId, setContactId] = useState(lockedContactId ?? "");

  const items = openItems ?? [];
  const isArap = Boolean(ARAP_ENDPOINTS[kind]);
  const needsContact = kind === "invoice";
  const showContactPicker = Boolean(lockContact || contacts != null);

  useEffect(() => {
    setOpenItemId(openItems?.[0]?.id ?? "");
  }, [openItems]);

  useEffect(() => {
    if (lockedContactId) setContactId(lockedContactId);
  }, [lockedContactId]);

  useEffect(() => {
    if (!openItemId) return;
    const selected = items.find((i) => i.id === openItemId);
    if (selected && (kind === "receipt" || kind === "loan_payment")) {
      setAmount(String(Math.round(selected.balanceAmount)));
    }
  }, [openItemId, items, kind]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    if (needsContact && !contactId) {
      toast.error("Pilih kontak dulu");
      return;
    }
    try {
      const endpoint = ARAP_ENDPOINTS[kind] ?? "/api/documents";
      const payload: Record<string, unknown> = {
        amount: Math.round(Number(amount.replace(/\D/g, "")) || 0),
        memo,
        date,
      };
      if (!isArap) {
        payload.kind = kind;
        payload.isPrive = defaults?.isPrive;
      }
      if (contactId) payload.contactId = contactId;
      if (kind === "invoice" && dueDate) payload.dueDate = dueDate;
      if (kind === "invoice") payload.isMonthly = isMonthly;
      if (requiresOpenItem && openItemId) payload.openItemId = openItemId;
      const res = await apiJson<{ document?: { nextInvoiceId?: string } }>(
        endpoint,
        { method: "POST", body: JSON.stringify(payload) },
        orgId,
      );
      if (kind === "receipt" && res.document?.nextInvoiceId) {
        toast.success("Tersimpan. Invoice bulanan berikutnya sudah dibuat.");
      } else {
        toast.success("Tersimpan");
      }
      setAmount("");
      setMemo("");
      setIsMonthly(false);
      await onSaved?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal");
    }
  }

  const lockedContactName = contacts?.find((c) => c.id === contactId)?.name;

  return (
    <div className="space-y-3">
      <h2 className="font-semibold">{title}</h2>
      <form onSubmit={onSubmit} className="bg-paper-card border border-sand rounded-lg p-5 space-y-4">
        {showContactPicker && (
          <Field label="Kontak">
            {lockContact ? (
              <TextInput value={lockedContactName || "Kontak terpilih"} disabled />
            ) : (
              <TextSelect
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                required={needsContact}
              >
                <option value="">{needsContact ? "Pilih kontak…" : "Tanpa kontak"}</option>
                {(contacts ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </TextSelect>
            )}
          </Field>
        )}
        {requiresOpenItem && items.length > 0 && (
          <Field label="Pilih saldo terbuka">
            <TextSelect
              value={openItemId}
              onChange={(e) => setOpenItemId(e.target.value)}
              required
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {(i.documentNumber ? `${i.documentNumber} · ` : "") +
                    (i.description || "—") +
                    ` · sisa ${formatIDR(i.balanceAmount)}` +
                    (i.isMonthly ? " · bulanan" : "")}
                </option>
              ))}
            </TextSelect>
          </Field>
        )}
        {requiresOpenItem && items.length === 0 && (
          <p className={warnBox}>Belum ada saldo terbuka. Catat invoice/hutang dulu.</p>
        )}
        <Field label={kind === "receipt" || kind === "loan_payment" ? "Tanggal pembayaran" : "Tanggal"}>
          <TextInput type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {kind === "invoice" && (
          <Field label="Jatuh tempo">
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        )}
        {kind === "invoice" && (
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-sand text-pine focus:ring-pine"
              checked={isMonthly}
              onChange={(e) => setIsMonthly(e.target.checked)}
            />
            <span>
              <span className="font-medium text-ink">Tagihan bulanan</span>
              <span className="block text-ink-muted text-xs mt-0.5">
                Setelah lunas, sistem membuat invoice baru dengan jatuh tempo di tanggal yang sama bulan berikutnya.
              </span>
            </span>
          </label>
        )}
        <Field label="Nominal">
          <TextInput required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Keterangan">
          <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Opsional" />
        </Field>
        <button
          className="bg-pine text-white rounded-lg px-5 py-2.5 text-sm font-medium w-full disabled:opacity-50"
          disabled={requiresOpenItem && items.length === 0}
        >
          Catat
        </button>
      </form>
    </div>
  );
}

function useDocsAndOpenItems(kinds: string[], openItemKind?: "receivable" | "payable") {
  const orgId = useOrgId();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);

  async function reload() {
    if (!orgId) return;
    const kindSet = new Set(kinds);
    const [d, oi] = await Promise.all([
      apiJson<{ documents: Doc[] }>("/api/documents", {}, orgId),
      openItemKind
        ? apiJson<{ openItems: OpenItem[] }>(`/api/open-items?kind=${openItemKind}`, {}, orgId)
        : Promise.resolve({ openItems: [] as OpenItem[] }),
    ]);
    setDocs((d.documents ?? []).filter((x) => kindSet.has(x.kind)));
    setOpenItems((oi.openItems ?? []).filter((i) => i.status === "open" || i.balanceAmount > 0));
  }

  useEffect(() => {
    void reload().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return { docs, openItems, reload };
}

export function CapitalPage() {
  const { docs, reload } = useDocsAndOpenItems(["capital"]);

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl">Modal</h1>
      <div className="grid sm:grid-cols-2 gap-6 max-w-4xl">
        <SimpleDocForm title="Setor modal" kind="capital" onSaved={reload} />
        <SimpleDocForm title="Prive / tarik modal" kind="capital" defaults={{ isPrive: true }} onSaved={reload} />
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">Riwayat modal</h2>
        <DocListFilters docs={docs} empty="Belum ada transaksi modal." />
      </section>
    </div>
  );
}

export function PayablesPage() {
  const { docs, openItems, reload } = useDocsAndOpenItems(["loan_in", "loan_payment"], "payable");
  const openTotal = openItems.reduce((s, i) => s + i.balanceAmount, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl">Hutang</h1>
        {openItems.length > 0 && (
          <p className="text-sm text-ink-muted">
            Total terbuka: <span className="font-semibold text-ink">{formatIDR(openTotal)}</span>
          </p>
        )}
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">Saldo terbuka</h2>
        <OpenItemsTable items={openItems} empty="Belum ada hutang terbuka." />
      </section>
      <div className="grid sm:grid-cols-2 gap-6 max-w-4xl">
        <SimpleDocForm title="Terima hutang / pinjaman" kind="loan_in" openItems={openItems} onSaved={reload} />
        <SimpleDocForm title="Bayar hutang" kind="loan_payment" openItems={openItems} requiresOpenItem onSaved={reload} />
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">Riwayat</h2>
        <DocListFilters
          docs={docs}
          empty="Belum ada transaksi hutang."
          kindOptions={[
            { value: "loan_in", label: "Terima hutang" },
            { value: "loan_payment", label: "Bayar hutang" },
          ]}
        />
      </section>
    </div>
  );
}

export function ReceivablesPage() {
  const orgId = useOrgId();
  const { docs, openItems, reload } = useDocsAndOpenItems(["invoice", "receipt"], "receivable");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [completeItem, setCompleteItem] = useState<OpenItem | null>(null);
  const openTotal = openItems.reduce((s, i) => s + i.balanceAmount, 0);

  useEffect(() => {
    if (!orgId) return;
    void apiJson<{ contacts: Contact[] }>("/api/contacts", {}, orgId)
      .then((r) => setContacts(r.contacts ?? []))
      .catch(() => undefined);
  }, [orgId]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl">Piutang</h1>
        {openItems.length > 0 && (
          <p className="text-sm text-ink-muted">
            Total terbuka: <span className="font-semibold text-ink">{formatIDR(openTotal)}</span>
          </p>
        )}
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">Saldo terbuka</h2>
        <OpenItemsTable
          items={openItems}
          empty="Belum ada piutang terbuka."
          showActions
          onComplete={setCompleteItem}
        />
      </section>
      <div className="grid sm:grid-cols-2 gap-6 max-w-4xl">
        <SimpleDocForm
          title="Catat piutang (invoice)"
          kind="invoice"
          openItems={openItems}
          contacts={contacts}
          onSaved={reload}
        />
        <SimpleDocForm
          title="Terima pelunasan piutang"
          kind="receipt"
          openItems={openItems}
          requiresOpenItem
          contacts={contacts}
          onSaved={reload}
        />
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">Riwayat</h2>
        <DocListFilters
          docs={docs}
          empty="Belum ada transaksi piutang."
          kindOptions={[
            { value: "invoice", label: "Invoice" },
            { value: "receipt", label: "Pelunasan" },
          ]}
        />
      </section>
      {completeItem ? (
        <CompletePaymentDialog
          item={completeItem}
          onClose={() => setCompleteItem(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

export function CashPage() {
  const orgId = useOrgId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    if (!orgId) return;
    void apiJson<{ accounts: Account[] }>("/api/accounts", {}, orgId).then((r) =>
      setAccounts((r.accounts ?? []).filter((a) => a.isCash)),
    );
  }, [orgId]);

  const total = accounts.reduce((s, a) => s + (a.balance ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl">Kas & Bank</h1>
        {accounts.length > 0 && (
          <p className="text-sm text-ink-muted">
            Total: <span className="font-semibold text-pine-dark dark:text-pine">{formatIDR(total)}</span>
          </p>
        )}
      </div>
      {accounts.length === 0 ? (
        <EmptyState>Belum ada akun kas.</EmptyState>
      ) : (
        <DataTable
          headers={[
            { label: "Kode" },
            { label: "Nama" },
            { label: "Saldo", align: "right" },
          ]}
        >
          {accounts.map((a) => (
            <DataRow key={a.id}>
              <Td mono>{a.code}</Td>
              <Td>{a.name}</Td>
              <Td align="right" className="font-semibold text-pine-dark dark:text-pine">
                {a.balance !== undefined ? formatIDR(a.balance) : "—"}
              </Td>
            </DataRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}

export function AccountsPage() {
  const orgId = useOrgId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [q, setQ] = useState("");
  const [cashOnly, setCashOnly] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    void apiJson<{ accounts: Account[] }>("/api/accounts", {}, orgId).then((r) => setAccounts(r.accounts ?? []));
  }, [orgId]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return accounts.filter((a) => {
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      if (cashOnly && !a.isCash) return false;
      if (query && !`${a.code} ${a.name}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [accounts, typeFilter, q, cashOnly]);

  const hasBalance = filtered.some((a) => a.balance !== undefined);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">Bagan akun</h1>
      <FilterBar>
        <Field label="Tipe" className="min-w-[10rem]">
          <TextSelect value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">Semua</option>
            <option value="asset">Aset</option>
            <option value="liability">Kewajiban</option>
            <option value="equity">Ekuitas</option>
            <option value="revenue">Pendapatan</option>
            <option value="expense">Beban</option>
          </TextSelect>
        </Field>
        <Field label="Cari" className="min-w-[14rem] flex-1">
          <TextInput placeholder="Kode atau nama…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-muted cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-sand text-pine focus:ring-pine/30"
            checked={cashOnly}
            onChange={(e) => setCashOnly(e.target.checked)}
          />
          Hanya kas
        </label>
      </FilterBar>
      {accounts.length === 0 ? (
        <EmptyState>Belum ada akun.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Tidak ada akun yang cocok dengan filter.</EmptyState>
      ) : (
        <DataTable
          headers={[
            { label: "Kode" },
            { label: "Nama" },
            { label: "Tipe" },
            ...(hasBalance ? [{ label: "Saldo", align: "right" as const }] : []),
          ]}
        >
          {filtered.map((a) => (
            <DataRow key={a.id}>
              <Td mono>{a.code}</Td>
              <Td>{a.name}</Td>
              <Td>
                {accountTypeLabel(a.type)}
                {a.isCash ? " · kas" : ""}
              </Td>
              {hasBalance && (
                <Td align="right">{a.balance !== undefined ? formatIDR(a.balance) : "—"}</Td>
              )}
            </DataRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}

export function JournalsPage() {
  const orgId = useOrgId();
  const [entries, setEntries] = useState<{ id: string; entryDate: string; memo: string; status: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ entry: { id: string; memo: string; status: string; entryDate: string }; lines: JournalLine[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  async function reload() {
    if (!orgId) return;
    const r = await apiJson<{ entries: typeof entries }>("/api/journals", {}, orgId);
    setEntries(r.entries ?? []);
  }

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [orgId]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (!inDateRange(String(e.entryDate), from, to)) return false;
      if (query && !(e.memo || "").toLowerCase().includes(query)) return false;
      return true;
    });
  }, [entries, statusFilter, from, to, q]);

  async function loadDetail(id: string) {
    if (!orgId) return;
    setSelectedId(id);
    setLoadingDetail(true);
    try {
      const r = await apiJson<{ entry: typeof detail extends null ? never : NonNullable<typeof detail>["entry"]; lines: JournalLine[] }>(
        `/api/journals/${id}`,
        {},
        orgId,
      );
      setDetail(r);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat jurnal");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function voidEntry() {
    if (!orgId || !selectedId) return;
    if (!window.confirm("Batalkan jurnal ini?")) return;
    try {
      await apiJson(`/api/journals/${selectedId}/void`, { method: "POST" }, orgId);
      toast.success("Jurnal dibatalkan");
      setDetail(null);
      setSelectedId(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal membatalkan");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Jurnal</h1>
      <FilterBar>
        <Field label="Status" className="min-w-[10rem]">
          <TextSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Semua</option>
            <option value="posted">Diposting</option>
            <option value="voided">Dibatalkan</option>
          </TextSelect>
        </Field>
        <Field label="Dari" className="min-w-[10rem]">
          <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Sampai" className="min-w-[10rem]">
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Cari" className="min-w-[14rem] flex-1">
          <TextInput placeholder="Keterangan…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
      </FilterBar>
      {entries.length === 0 ? (
        <EmptyState>Belum ada jurnal.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Tidak ada jurnal yang cocok dengan filter.</EmptyState>
      ) : (
        <DataTable
          headers={[
            { label: "Tanggal" },
            { label: "Keterangan" },
            { label: "Status" },
          ]}
        >
          {filtered.map((e) => (
            <DataRow key={e.id} active={selectedId === e.id} onClick={() => void loadDetail(e.id)}>
              <Td>{formatDateID(String(e.entryDate).slice(0, 10))}</Td>
              <Td>{e.memo || "—"}</Td>
              <Td>
                <StatusBadge status={e.status} />
              </Td>
            </DataRow>
          ))}
        </DataTable>
      )}
      {loadingDetail && <p className="text-sm text-ink-muted">Memuat detail…</p>}
      {detail && !loadingDetail && (
        <section className="bg-paper-card border border-sand rounded-lg p-5 space-y-4">
          <div className="flex justify-between items-start gap-3">
            <div>
              <h2 className="font-semibold">Detail jurnal</h2>
              <p className="text-sm text-ink-muted">
                {formatDateID(String(detail.entry.entryDate).slice(0, 10))} · {detail.entry.memo || "—"}
              </p>
              <div className="mt-1">
                <StatusBadge status={detail.entry.status} />
              </div>
            </div>
            {detail.entry.status !== "voided" && (
              <button type="button" onClick={() => void voidEntry()} className={dangerBtn}>
                Batalkan jurnal
              </button>
            )}
          </div>
          <DataTable
            headers={[
              { label: "Akun" },
              { label: "Debit", align: "right" },
              { label: "Kredit", align: "right" },
            ]}
          >
            {detail.lines.map((l) => (
              <DataRow key={l.id}>
                <Td>
                  {l.accountCode} — {l.accountName}
                </Td>
                <Td align="right">{l.debit > 0 ? formatIDR(l.debit) : "—"}</Td>
                <Td align="right">{l.credit > 0 ? formatIDR(l.credit) : "—"}</Td>
              </DataRow>
            ))}
          </DataTable>
        </section>
      )}
    </div>
  );
}

export function ReportsPage() {
  const orgId = useOrgId();
  const [from, setFrom] = useState(monthStartISO);
  const [to, setTo] = useState(todayISO);
  const [pl, setPl] = useState<{ totalRevenue: number; totalExpense: number; netIncome: number } | null>(null);
  const [bs, setBs] = useState<{ totalAssets: number; totalLiabilities: number; equityWithIncome: number } | null>(null);
  const [tb, setTb] = useState<{ totalDebit: number; totalCredit: number } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    const qs = `from=${from}&to=${to}`;
    void Promise.all([
      apiJson<NonNullable<typeof pl>>(`/api/reports/profit-loss?${qs}`, {}, orgId),
      apiJson<NonNullable<typeof bs>>(`/api/reports/balance-sheet?asOf=${to}`, {}, orgId),
      apiJson<NonNullable<typeof tb>>(`/api/reports/trial-balance?asOf=${to}`, {}, orgId),
    ]).then(([a, b, c]) => {
      setPl(a);
      setBs(b);
      setTb(c);
    });
  }, [orgId, from, to]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Laporan</h1>
      <FilterBar>
        <Field label="Dari tanggal" className="min-w-[12rem]">
          <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Sampai tanggal" className="min-w-[12rem]">
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </FilterBar>
      <div className="grid lg:grid-cols-3 gap-4">
        {pl && (
          <section className="bg-paper-card border border-sand rounded-lg p-5">
            <h2 className="font-semibold mb-3">
              Laba rugi ({formatDateID(from)} — {formatDateID(to)})
            </h2>
            <ReportLine label="Pendapatan" value={pl.totalRevenue} />
            <ReportLine label="Beban" value={pl.totalExpense} />
            <ReportLine label="Laba bersih" value={pl.netIncome} strong />
          </section>
        )}
        {bs && (
          <section className="bg-paper-card border border-sand rounded-lg p-5">
            <h2 className="font-semibold mb-3">Neraca (per {formatDateID(to)})</h2>
            <ReportLine label="Aset" value={bs.totalAssets} />
            <ReportLine label="Kewajiban" value={bs.totalLiabilities} />
            <ReportLine label="Ekuitas (+ laba)" value={bs.equityWithIncome} strong />
          </section>
        )}
        {tb && (
          <section className="bg-paper-card border border-sand rounded-lg p-5">
            <h2 className="font-semibold mb-3">Neraca saldo (per {formatDateID(to)})</h2>
            <ReportLine label="Total debit" value={tb.totalDebit} />
            <ReportLine label="Total kredit" value={tb.totalCredit} />
          </section>
        )}
      </div>
    </div>
  );
}

export function AssetsPage() {
  const orgId = useOrgId();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [name, setName] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("60");
  const [salvageValue, setSalvageValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!orgId) return;
    const r = await apiJson<{ assets: Asset[] }>("/api/assets", {}, orgId);
    setAssets(r.assets ?? []);
  }

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [orgId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    try {
      await apiJson(
        "/api/assets",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            acquisitionDate,
            acquisitionCost: Math.round(Number(acquisitionCost.replace(/\D/g, "")) || 0),
            usefulLifeMonths: Number(usefulLifeMonths) || 60,
            salvageValue: salvageValue ? Math.round(Number(salvageValue.replace(/\D/g, "")) || 0) : undefined,
          }),
        },
        orgId,
      );
      toast.success("Aset ditambahkan");
      setName("");
      setAcquisitionCost("");
      setSalvageValue("");
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menambah aset");
    } finally {
      setBusy(false);
    }
  }

  async function depreciate() {
    if (!orgId) return;
    const periodYm = new Date().toISOString().slice(0, 7);
    setBusy(true);
    try {
      const r = await apiJson<{ processed?: number; skipped?: number }>(
        "/api/assets/depreciate",
        { method: "POST", body: JSON.stringify({ periodYm }) },
        orgId,
      );
      toast.success(`Penyusutan periode ${periodYm}: ${r.processed ?? 0} diproses`);
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal penyusutan");
    } finally {
      setBusy(false);
    }
  }

  async function disposeAsset(id: string) {
    if (!orgId) return;
    if (!window.confirm("Lepas aset ini? Tindakan ini tidak bisa dibatalkan dari sini.")) return;
    setBusy(true);
    try {
      await apiJson(`/api/assets/${id}/dispose`, { method: "POST", body: JSON.stringify({}) }, orgId);
      toast.success("Aset dilepas");
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal lepas aset");
    } finally {
      setBusy(false);
    }
  }

  if (!orgId) return <p className="text-ink-muted">Pilih bisnis dulu.</p>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Aset tetap</h1>
        <button
          type="button"
          disabled={busy}
          onClick={() => void depreciate()}
          className="bg-pine text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          Jalankan penyusutan ({new Date().toISOString().slice(0, 7)})
        </button>
      </div>

      {assets.length === 0 ? (
        <EmptyState>Belum ada aset tetap.</EmptyState>
      ) : (
        <DataTable
          headers={[
            { label: "Nama" },
            { label: "Tanggal" },
            { label: "Perolehan", align: "right" },
            { label: "Masa manfaat" },
            { label: "Aksi" },
          ]}
        >
          {assets.map((a) => (
            <DataRow key={a.id}>
              <Td className="font-medium">{a.name}</Td>
              <Td>{formatDateID(a.acquisitionDate)}</Td>
              <Td align="right">{formatIDR(a.acquisitionCost)}</Td>
              <Td>{a.usefulLifeMonths} bln</Td>
              <Td>
                <button type="button" disabled={busy} onClick={() => void disposeAsset(a.id)} className={dangerBtn}>
                  Lepas aset
                </button>
              </Td>
            </DataRow>
          ))}
        </DataTable>
      )}

      <form onSubmit={onCreate} className="bg-paper-card border border-sand rounded-lg p-5 space-y-4 max-w-2xl">
        <h2 className="font-semibold">Tambah aset</h2>
        <Field label="Nama aset">
          <TextInput required value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Laptop kantor" />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Tanggal perolehan">
            <TextInput type="date" required value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
          </Field>
          <Field label="Nilai perolehan">
            <TextInput required value={acquisitionCost} onChange={(e) => setAcquisitionCost(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Masa manfaat (bulan)">
            <TextInput type="number" min={1} required value={usefulLifeMonths} onChange={(e) => setUsefulLifeMonths(e.target.value)} />
          </Field>
          <Field label="Nilai residu (opsional)">
            <TextInput value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} placeholder="0" />
          </Field>
        </div>
        <button type="submit" disabled={busy} className="bg-pine text-white rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-50">
          Simpan aset
        </button>
      </form>
    </div>
  );
}

export function BillingPage() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<Array<{ code: string; name: string; priceMonthly: number; priceYearly: number; maxOrgs: number; maxSeats: number }>>([]);
  const [subscription, setSubscription] = useState<{
    plan: string;
    subscriptionStatus: string;
    trialEndsAt: string | null;
    subscription: { planCode: string; status: string; currentPeriodEnd: string | null } | null;
    planDetails: { name: string; maxOrgs: number; maxSeats: number } | null;
  } | null>(null);
  const [usage, setUsage] = useState<{ orgCount: number; seatCount: number } | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([
      apiJson<{ plans: typeof plans }>("/api/billing/plans"),
      apiJson<typeof subscription>("/api/billing/subscription"),
      apiJson<typeof usage>("/api/billing/usage"),
    ])
      .then(([p, s, u]) => {
        setPlans(p.plans ?? []);
        setSubscription(s);
        setUsage(u);
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoaded(true));
  }, []);

  async function checkout(planCode: string) {
    setCheckingOut(planCode);
    try {
      const r = await apiJson<{ redirectUrl?: string; orderId: string }>(
        "/api/billing/checkout",
        { method: "POST", body: JSON.stringify({ planCode, interval: "monthly" }) },
      );
      if (r.redirectUrl) window.location.href = r.redirectUrl;
      else toast.success(`Checkout dibuat: ${r.orderId}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal checkout");
    } finally {
      setCheckingOut(null);
    }
  }

  const trialEnds = user?.trialEndsAt ?? subscription?.trialEndsAt;

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl">Langganan & Billing</h1>

      {trialEnds && (
        <section className="border border-sand bg-paper-card rounded-lg p-4 text-sm border-l-4 border-l-pine max-w-3xl">
          Masa trial berakhir: {new Date(trialEnds).toLocaleDateString("id-ID", { dateStyle: "long" })}
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
        {subscription && (
          <section className="bg-paper-card border border-sand rounded-lg p-5 space-y-2">
            <h2 className="font-semibold">Paket saat ini</h2>
            <p>Paket: {subscription.planDetails?.name ?? subscription.plan}</p>
            <p className="flex items-center gap-2">
              Status: <StatusBadge status={subscription.subscriptionStatus} variant="subscription" label={subscriptionStatusLabel(subscription.subscriptionStatus)} />
            </p>
            {subscription.subscription?.currentPeriodEnd && (
              <p className="text-sm text-ink-muted">
                Periode berakhir: {new Date(subscription.subscription.currentPeriodEnd).toLocaleDateString("id-ID")}
              </p>
            )}
          </section>
        )}

        {usage && (
          <section className="bg-paper-card border border-sand rounded-lg p-5 space-y-1">
            <h2 className="font-semibold">Penggunaan</h2>
            <p>Bisnis dimiliki: {usage.orgCount}</p>
            <p>Total kursi: {usage.seatCount}</p>
          </section>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Paket tersedia</h2>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div key={p.code} className="bg-paper-card border border-sand rounded-lg p-5 flex flex-col justify-between gap-4">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-sm text-ink-muted mt-1">
                  {formatIDR(p.priceMonthly)}/bulan · max {p.maxOrgs} bisnis · {p.maxSeats} kursi
                </p>
              </div>
              <button
                type="button"
                disabled={checkingOut === p.code}
                onClick={() => void checkout(p.code)}
                className="bg-pine text-white rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
              >
                {checkingOut === p.code ? "Memproses…" : "Berlangganan"}
              </button>
            </div>
          ))}
        </div>
        {!loaded && <p className="text-sm text-ink-muted">Memuat paket…</p>}
        {loaded && loadError && <EmptyState>Gagal memuat paket. Coba muat ulang.</EmptyState>}
        {loaded && !loadError && plans.length === 0 && <EmptyState>Belum ada paket tersedia.</EmptyState>}
      </section>
    </div>
  );
}

export function ContactsPage() {
  const orgId = useOrgId();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("customer");
  const [list, setList] = useState<Contact[]>([]);
  const [kindFilter, setKindFilter] = useState("all");
  const [q, setQ] = useState("");

  async function reload() {
    if (!orgId) return;
    const r = await apiJson<{ contacts: Contact[] }>("/api/contacts", {}, orgId);
    setList(r.contacts ?? []);
  }

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [orgId]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return list.filter((c) => {
      if (kindFilter !== "all" && c.kind !== kindFilter) return false;
      if (query && !c.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [list, kindFilter, q]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    try {
      await apiJson("/api/contacts", { method: "POST", body: JSON.stringify({ name, kind }) }, orgId);
      setName("");
      await reload();
      toast.success("Kontak ditambah");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Kontak</h1>
      <FilterBar>
        <Field label="Jenis" className="min-w-[10rem]">
          <TextSelect value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="all">Semua</option>
            <option value="customer">Pelanggan</option>
            <option value="vendor">Supplier</option>
            <option value="lender">Pemberi pinjaman</option>
            <option value="other">Lainnya</option>
          </TextSelect>
        </Field>
        <Field label="Cari" className="min-w-[14rem] flex-1">
          <TextInput placeholder="Nama kontak…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
      </FilterBar>
      {list.length === 0 ? (
        <EmptyState>Belum ada kontak.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Tidak ada kontak yang cocok dengan filter.</EmptyState>
      ) : (
        <DataTable
          headers={[
            { label: "Nama" },
            { label: "Jenis" },
            { label: "Email" },
          ]}
        >
          {filtered.map((c) => (
            <DataRow key={c.id} onClick={() => navigate(`/contacts/${c.id}`)}>
              <Td>{c.name}</Td>
              <Td>{contactKindLabel(c.kind)}</Td>
              <Td className="text-ink-muted">{c.email || "—"}</Td>
            </DataRow>
          ))}
        </DataTable>
      )}
      <form onSubmit={onSubmit} className="bg-paper-card border border-sand rounded-lg p-5 space-y-4 max-w-md">
        <h2 className="font-semibold">Tambah kontak</h2>
        <Field label="Nama">
          <TextInput required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama kontak" />
        </Field>
        <Field label="Jenis">
          <TextSelect value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="customer">Pelanggan</option>
            <option value="vendor">Supplier</option>
            <option value="lender">Pemberi pinjaman</option>
            <option value="other">Lainnya</option>
          </TextSelect>
        </Field>
        <button className="bg-pine text-white rounded-lg px-5 py-2.5 text-sm font-medium">Tambah</button>
      </form>
    </div>
  );
}

export function ContactDetailPage() {
  const orgId = useOrgId();
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [completeItem, setCompleteItem] = useState<OpenItem | null>(null);

  async function reload() {
    if (!orgId || !id) return;
    setLoadError(false);
    try {
      const [c, d, oi] = await Promise.all([
        apiJson<{ contact: Contact }>(`/api/contacts/${id}`, {}, orgId),
        apiJson<{ documents: Doc[] }>(`/api/documents?contactId=${encodeURIComponent(id)}`, {}, orgId),
        apiJson<{ openItems: OpenItem[] }>(
          `/api/open-items?kind=receivable&contactId=${encodeURIComponent(id)}`,
          {},
          orgId,
        ),
      ]);
      setContact(c.contact);
      const kindSet = new Set(["invoice", "receipt"]);
      setDocs((d.documents ?? []).filter((x) => kindSet.has(x.kind)));
      setOpenItems((oi.openItems ?? []).filter((i) => i.status === "open" || i.balanceAmount > 0));
    } catch {
      setLoadError(true);
      setContact(null);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, id]);

  const openTotal = openItems.reduce((s, i) => s + i.balanceAmount, 0);
  const contactList = contact ? [contact] : [];

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link to="/contacts" className="text-sm text-pine hover:underline">
          ← Kembali ke kontak
        </Link>
        <EmptyState>Kontak tidak ditemukan.</EmptyState>
      </div>
    );
  }

  if (!contact) {
    return <p className="text-ink-muted">Memuat kontak…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to="/contacts" className="text-sm text-pine hover:underline">
          ← Kembali ke kontak
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">{contact.name}</h1>
            <p className="text-sm text-ink-muted mt-1">{contactKindLabel(contact.kind)}</p>
          </div>
          {openItems.length > 0 && (
            <p className="text-sm text-ink-muted">
              Piutang terbuka: <span className="font-semibold text-ink">{formatIDR(openTotal)}</span>
            </p>
          )}
        </div>
        {(contact.email || contact.phone || contact.address) && (
          <dl className="text-sm text-ink-muted space-y-1 max-w-xl">
            {contact.email && (
              <div>
                <dt className="inline text-ink-faint">Email: </dt>
                <dd className="inline">{contact.email}</dd>
              </div>
            )}
            {contact.phone && (
              <div>
                <dt className="inline text-ink-faint">Telepon: </dt>
                <dd className="inline">{contact.phone}</dd>
              </div>
            )}
            {contact.address && (
              <div>
                <dt className="inline text-ink-faint">Alamat: </dt>
                <dd className="inline">{contact.address}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">Saldo terbuka</h2>
        <OpenItemsTable
          items={openItems}
          empty="Belum ada piutang terbuka untuk kontak ini."
          showActions
          onComplete={setCompleteItem}
        />
      </section>

      <div className="grid sm:grid-cols-2 gap-6 max-w-4xl">
        <SimpleDocForm
          title="Buat invoice"
          kind="invoice"
          contactId={contact.id}
          contacts={contactList}
          lockContact
          onSaved={reload}
        />
        <SimpleDocForm
          title="Terima pelunasan"
          kind="receipt"
          contactId={contact.id}
          contacts={contactList}
          lockContact
          openItems={openItems}
          requiresOpenItem
          onSaved={reload}
        />
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Riwayat</h2>
        <DocListFilters
          docs={docs}
          empty="Belum ada invoice/pelunasan untuk kontak ini."
          kindOptions={[
            { value: "invoice", label: "Invoice" },
            { value: "receipt", label: "Pelunasan" },
          ]}
        />
      </section>

      {completeItem ? (
        <CompletePaymentDialog
          item={completeItem}
          onClose={() => setCompleteItem(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

export function InvoicePrintPage() {
  const orgId = useOrgId();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [data, setData] = useState<{
    document: Doc;
    organization: { id: string; name: string };
    contact: Contact | null;
  } | null>(null);

  useEffect(() => {
    if (!orgId || !id) return;
    setLoading(true);
    void apiJson<{
      document: Doc;
      organization: { id: string; name: string };
      contact: Contact | null;
    }>(`/api/documents/${id}`, {}, orgId)
      .then((r) => {
        setData(r);
        setError(false);
      })
      .catch(() => {
        setError(true);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [orgId, id]);

  if (loading) return <p className="p-8 text-ink-muted">Memuat invoice…</p>;
  if (error || !data) {
    return (
      <div className="p-8 space-y-3">
        <EmptyState>Invoice tidak ditemukan.</EmptyState>
        <Link to="/receivables" className="text-sm text-pine hover:underline">
          ← Kembali ke piutang
        </Link>
      </div>
    );
  }

  const { document: doc, organization, contact } = data;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="print:hidden sticky top-0 z-10 border-b border-sand bg-paper-card/95 backdrop-blur px-4 py-3 flex flex-wrap gap-3 justify-between items-center">
        <Link to="/receivables" className="text-sm text-pine hover:underline">
          ← Kembali
        </Link>
        <button
          type="button"
          className="bg-pine text-white rounded-lg px-5 py-2 text-sm font-medium"
          onClick={() => window.print()}
        >
          Cetak invoice
        </button>
      </div>

      <article className="invoice-print mx-auto max-w-3xl px-6 py-10 space-y-8">
        <header className="flex flex-wrap justify-between gap-6 border-b border-sand pb-6">
          <div>
            <p className="font-display text-2xl text-pine">{organization.name || "Finbiz"}</p>
            <p className="text-sm text-ink-muted mt-1">Invoice</p>
          </div>
          <div className="text-right text-sm space-y-1">
            <p className="font-mono font-semibold text-base">{doc.number || doc.id.slice(0, 8)}</p>
            <p>
              Tanggal: <span className="text-ink">{formatDateID(doc.date)}</span>
            </p>
            {doc.dueDate ? (
              <p>
                Jatuh tempo: <span className="text-ink">{formatDateID(doc.dueDate)}</span>
              </p>
            ) : null}
            {doc.isMonthly ? <p className="text-pine text-xs">Tagihan bulanan</p> : null}
          </div>
        </header>

        <section className="grid sm:grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-ink-faint uppercase tracking-wide text-xs mb-1">Ditagihkan kepada</p>
            {contact ? (
              <div className="space-y-0.5">
                <p className="font-semibold text-base">{contact.name}</p>
                {contact.address ? <p className="text-ink-muted whitespace-pre-line">{contact.address}</p> : null}
                {contact.email ? <p className="text-ink-muted">{contact.email}</p> : null}
                {contact.phone ? <p className="text-ink-muted">{contact.phone}</p> : null}
                {contact.taxId ? <p className="text-ink-muted">NPWP: {contact.taxId}</p> : null}
              </div>
            ) : (
              <p className="text-ink-muted">—</p>
            )}
          </div>
          <div>
            <p className="text-ink-faint uppercase tracking-wide text-xs mb-1">Status</p>
            <StatusBadge status={doc.status} />
          </div>
        </section>

        <section>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-sand text-left text-ink-muted">
                <th className="py-2 font-medium">Keterangan</th>
                <th className="py-2 font-medium text-right">Nominal</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-sand">
                <td className="py-3">{doc.memo || "Invoice"}</td>
                <td className="py-3 text-right font-medium">{formatIDR(doc.amount)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-4 font-semibold">Total</td>
                <td className="pt-4 text-right font-semibold text-lg">{formatIDR(doc.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <footer className="text-xs text-ink-faint border-t border-sand pt-4">
          Dokumen ini digenerate dari Finbiz.
        </footer>
      </article>
    </div>
  );
}
