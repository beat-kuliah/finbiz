import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ApiError, apiJson, formatIDR } from "@/lib/api";
import { useAuth } from "@/store/auth";

type Account = { id: string; code: string; name: string; type: string; isCash: boolean; balance?: number };
type Doc = { id: string; kind: string; status: string; date: string; amount: number; memo: string };
type OpenItem = {
  id: string;
  description: string;
  originalAmount: number;
  balanceAmount: number;
  dueDate: string | null;
  status: string;
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

function useOrgId() {
  return useAuth((s) => s.activeOrgId);
}

export function TransactionsPage() {
  const orgId = useOrgId();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [kind, setKind] = useState("cash_in");
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
    setDocs(d.documents ?? []);
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
            date: new Date().toISOString().slice(0, 10),
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
    <div className="space-y-8 max-w-3xl">
      <h1 className="font-display text-3xl">Transaksi</h1>
      <form onSubmit={onSubmit} className="bg-paper-card border border-sand rounded-lg p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm">Jenis</label>
            <select className="w-full rounded border border-sand px-3 py-2" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="cash_in">Kas masuk</option>
              <option value="cash_out">Kas keluar</option>
              <option value="transfer">Transfer</option>
            </select>
          </div>
          <div>
            <label className="text-sm">Nominal</label>
            <input className="w-full rounded border border-sand px-3 py-2" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-sm">Keterangan</label>
          <input className="w-full rounded border border-sand px-3 py-2" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {kind === "transfer" ? (
            <>
              <div>
                <label className="text-sm">Akun kas sumber</label>
                <select className="w-full rounded border border-sand px-3 py-2" value={cashId} onChange={(e) => setCashId(e.target.value)}>
                  {accounts.filter((a) => a.isCash).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm">Akun kas tujuan</label>
                <select className="w-full rounded border border-sand px-3 py-2" value={counterId} onChange={(e) => setCounterId(e.target.value)}>
                  {accounts.filter((a) => a.isCash).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm">Akun kas/bank</label>
                <select className="w-full rounded border border-sand px-3 py-2" value={cashId} onChange={(e) => setCashId(e.target.value)}>
                  {accounts.filter((a) => a.isCash).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm">Akun lawan</label>
                <select className="w-full rounded border border-sand px-3 py-2" value={counterId} onChange={(e) => setCounterId(e.target.value)}>
                  {accounts.filter((a) => !a.isCash).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
        <button className="bg-pine text-white rounded px-4 py-2">Simpan</button>
      </form>
      <ul className="space-y-2">
        {docs.map((d) => (
          <li key={d.id} className="flex justify-between border-b border-sand py-2 text-sm">
            <span>{d.kind} · {d.memo || "—"} · {d.status}</span>
            <span className="font-medium">{formatIDR(d.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SimpleDocForm({
  title,
  kind,
  defaults,
  openItemKind,
  requiresOpenItem,
}: {
  title: string;
  kind: string;
  defaults?: Partial<{ isPrive: boolean }>;
  openItemKind?: "receivable" | "payable";
  requiresOpenItem?: boolean;
}) {
  const orgId = useOrgId();
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [openItemId, setOpenItemId] = useState("");

  useEffect(() => {
    if (!orgId || !openItemKind) return;
    void apiJson<{ openItems: OpenItem[] }>(`/api/open-items?kind=${openItemKind}`, {}, orgId)
      .then((r) => {
        const items = (r.openItems ?? []).filter((i) => i.status === "open" || i.balanceAmount > 0);
        setOpenItems(items);
        if (items[0]) setOpenItemId(items[0].id);
      })
      .catch(() => undefined);
  }, [orgId, openItemKind]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    try {
      const payload: Record<string, unknown> = {
        kind,
        amount: Math.round(Number(amount.replace(/\D/g, "")) || 0),
        memo,
        isPrive: defaults?.isPrive,
        date: new Date().toISOString().slice(0, 10),
      };
      if (requiresOpenItem && openItemId) payload.openItemId = openItemId;
      await apiJson("/api/documents", { method: "POST", body: JSON.stringify(payload) }, orgId);
      toast.success("Tersimpan");
      setAmount("");
      setMemo("");
      if (openItemKind) {
        const r = await apiJson<{ openItems: OpenItem[] }>(`/api/open-items?kind=${openItemKind}`, {}, orgId);
        const items = (r.openItems ?? []).filter((i) => i.status === "open" || i.balanceAmount > 0);
        setOpenItems(items);
        setOpenItemId(items[0]?.id ?? "");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal");
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <h2 className="font-display text-2xl">{title}</h2>
      {openItemKind && openItems.length > 0 && (
        <div className="bg-paper-card border border-sand rounded-lg p-4">
          <p className="text-sm font-medium mb-2">Saldo terbuka</p>
          <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
            {openItems.map((i) => (
              <li key={i.id} className="flex justify-between text-ink-muted">
                <span>{i.description || "—"}</span>
                <span>{formatIDR(i.balanceAmount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={onSubmit} className="bg-paper-card border border-sand rounded-lg p-5 space-y-3">
        {requiresOpenItem && openItems.length > 0 && (
          <div>
            <label className="text-sm">Pilih saldo terbuka</label>
            <select
              className="w-full rounded border border-sand px-3 py-2"
              value={openItemId}
              onChange={(e) => setOpenItemId(e.target.value)}
              required
            >
              {openItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.description || "—"} · sisa {formatIDR(i.balanceAmount)}
                </option>
              ))}
            </select>
          </div>
        )}
        {requiresOpenItem && openItems.length === 0 && (
          <p className="text-sm text-amber-700">Belum ada saldo terbuka. Catat invoice/hutang dulu.</p>
        )}
        <input className="w-full rounded border border-sand px-3 py-2" placeholder="Nominal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="w-full rounded border border-sand px-3 py-2" placeholder="Keterangan" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <button
          className="bg-pine text-white rounded px-4 py-2 w-full disabled:opacity-50"
          disabled={requiresOpenItem && openItems.length === 0}
        >
          Catat
        </button>
      </form>
    </div>
  );
}

export function CapitalPage() {
  return (
    <div className="space-y-10">
      <SimpleDocForm title="Setor modal" kind="capital" />
      <SimpleDocForm title="Prive / tarik modal" kind="capital" defaults={{ isPrive: true }} />
    </div>
  );
}

export function PayablesPage() {
  return (
    <div className="space-y-10">
      <h1 className="font-display text-3xl">Hutang</h1>
      <SimpleDocForm title="Terima hutang / pinjaman" kind="loan_in" openItemKind="payable" />
      <SimpleDocForm title="Bayar hutang" kind="loan_payment" openItemKind="payable" requiresOpenItem />
    </div>
  );
}

export function ReceivablesPage() {
  return (
    <div className="space-y-10">
      <h1 className="font-display text-3xl">Piutang</h1>
      <SimpleDocForm title="Catat piutang (invoice)" kind="invoice" openItemKind="receivable" />
      <SimpleDocForm title="Terima pelunasan piutang" kind="receipt" openItemKind="receivable" requiresOpenItem />
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
  return (
    <div>
      <h1 className="font-display text-3xl mb-4">Kas & Bank</h1>
      <ul className="space-y-2">
        {accounts.map((a) => (
          <li key={a.id} className="bg-paper-card border border-sand rounded px-4 py-3 flex justify-between items-center">
            <span>{a.code} — {a.name}</span>
            {a.balance !== undefined && (
              <span className="font-semibold text-pine-dark">{formatIDR(a.balance)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AccountsPage() {
  const orgId = useOrgId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    if (!orgId) return;
    void apiJson<{ accounts: Account[] }>("/api/accounts", {}, orgId).then((r) => setAccounts(r.accounts ?? []));
  }, [orgId]);
  return (
    <div>
      <h1 className="font-display text-3xl mb-4">Bagan akun</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-faint border-b border-sand">
              <th className="py-2">Kode</th>
              <th>Nama</th>
              <th>Tipe</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-sand/70">
                <td className="py-2 font-mono">{a.code}</td>
                <td>{a.name}</td>
                <td>{a.type}{a.isCash ? " · kas" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function JournalsPage() {
  const orgId = useOrgId();
  const [entries, setEntries] = useState<{ id: string; entryDate: string; memo: string; status: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ entry: { id: string; memo: string; status: string; entryDate: string }; lines: JournalLine[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function reload() {
    if (!orgId) return;
    const r = await apiJson<{ entries: typeof entries }>("/api/journals", {}, orgId);
    setEntries(r.entries ?? []);
  }

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [orgId]);

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
    <div className="space-y-6 max-w-3xl">
      <h1 className="font-display text-3xl">Jurnal</h1>
      <ul className="space-y-2 text-sm">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => void loadDetail(e.id)}
              className={`w-full text-left border-b border-sand py-2 flex justify-between hover:bg-sand/40 rounded px-2 ${selectedId === e.id ? "bg-sand/60" : ""}`}
            >
              <span>{String(e.entryDate).slice(0, 10)} · {e.memo || "—"}</span>
              <span className={e.status === "voided" ? "text-red-700" : "text-pine"}>{e.status}</span>
            </button>
          </li>
        ))}
      </ul>
      {loadingDetail && <p className="text-sm text-ink-muted">Memuat detail…</p>}
      {detail && !loadingDetail && (
        <section className="bg-paper-card border border-sand rounded-lg p-5 space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="font-semibold">Detail jurnal</h2>
              <p className="text-sm text-ink-muted">{String(detail.entry.entryDate).slice(0, 10)} · {detail.entry.memo || "—"}</p>
            </div>
            {detail.entry.status !== "voided" && (
              <button type="button" onClick={() => void voidEntry()} className="text-sm text-red-700 border border-red-200 rounded px-3 py-1 hover:bg-red-50">
                Batalkan jurnal
              </button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint border-b border-sand">
                <th className="py-2">Akun</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Kredit</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id} className="border-b border-sand/70">
                  <td className="py-2">{l.accountCode} — {l.accountName}</td>
                  <td className="text-right">{l.debit > 0 ? formatIDR(l.debit) : "—"}</td>
                  <td className="text-right">{l.credit > 0 ? formatIDR(l.credit) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

export function ReportsPage() {
  const orgId = useOrgId();
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = now.toISOString().slice(0, 10);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [pl, setPl] = useState<{ totalRevenue: number; totalExpense: number; netIncome: number } | null>(null);
  const [bs, setBs] = useState<{ totalAssets: number; totalLiabilities: number; equityWithIncome: number } | null>(null);
  const [tb, setTb] = useState<{ totalDebit: number; totalCredit: number } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    const qs = `from=${from}&to=${to}`;
    void Promise.all([
      apiJson<typeof pl>(`/api/reports/profit-loss?${qs}`, {}, orgId),
      apiJson<typeof bs>(`/api/reports/balance-sheet?asOf=${to}`, {}, orgId),
      apiJson<typeof tb>(`/api/reports/trial-balance?asOf=${to}`, {}, orgId),
    ]).then(([a, b, c]) => {
      setPl(a);
      setBs(b);
      setTb(c);
    });
  }, [orgId, from, to]);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="font-display text-3xl">Laporan</h1>
      <div className="flex flex-wrap gap-3 items-end bg-paper-card border border-sand rounded-lg p-4">
        <div>
          <label className="text-sm block mb-1">Dari tanggal</label>
          <input type="date" className="rounded border border-sand px-3 py-2" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-sm block mb-1">Sampai tanggal</label>
          <input type="date" className="rounded border border-sand px-3 py-2" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {pl && (
        <section className="bg-paper-card border border-sand rounded-lg p-5">
          <h2 className="font-semibold mb-2">Laba rugi ({from} — {to})</h2>
          <p>Pendapatan: {formatIDR(pl.totalRevenue)}</p>
          <p>Beban: {formatIDR(pl.totalExpense)}</p>
          <p className="font-semibold mt-1">Laba bersih: {formatIDR(pl.netIncome)}</p>
        </section>
      )}
      {bs && (
        <section className="bg-paper-card border border-sand rounded-lg p-5">
          <h2 className="font-semibold mb-2">Neraca (per {to})</h2>
          <p>Aset: {formatIDR(bs.totalAssets)}</p>
          <p>Kewajiban: {formatIDR(bs.totalLiabilities)}</p>
          <p>Ekuitas (+ laba): {formatIDR(bs.equityWithIncome)}</p>
        </section>
      )}
      {tb && (
        <section className="bg-paper-card border border-sand rounded-lg p-5">
          <h2 className="font-semibold mb-2">Neraca saldo (per {to})</h2>
          <p>Total debit: {formatIDR(tb.totalDebit)}</p>
          <p>Total kredit: {formatIDR(tb.totalCredit)}</p>
        </section>
      )}
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
    setBusy(true);
    try {
      await apiJson(`/api/assets/${id}/dispose`, { method: "POST", body: JSON.stringify({}) }, orgId);
      toast.success("Aset di-dispose");
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal dispose");
    } finally {
      setBusy(false);
    }
  }

  if (!orgId) return <p className="text-ink-muted">Pilih bisnis dulu.</p>;

  return (
    <div className="space-y-8 max-w-3xl">
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

      <form onSubmit={onCreate} className="bg-paper-card border border-sand rounded-lg p-5 space-y-3">
        <h2 className="font-semibold">Tambah aset</h2>
        <input className="w-full rounded border border-sand px-3 py-2" placeholder="Nama aset" required value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm">Tanggal perolehan</label>
            <input type="date" className="w-full rounded border border-sand px-3 py-2" required value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Nilai perolehan</label>
            <input className="w-full rounded border border-sand px-3 py-2" required value={acquisitionCost} onChange={(e) => setAcquisitionCost(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Masa manfaat (bulan)</label>
            <input type="number" min={1} className="w-full rounded border border-sand px-3 py-2" required value={usefulLifeMonths} onChange={(e) => setUsefulLifeMonths(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Nilai residu (opsional)</label>
            <input className="w-full rounded border border-sand px-3 py-2" value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} />
          </div>
        </div>
        <button type="submit" disabled={busy} className="bg-pine text-white rounded px-4 py-2 disabled:opacity-50">Simpan aset</button>
      </form>

      <ul className="space-y-2">
        {assets.map((a) => (
          <li key={a.id} className="bg-paper-card border border-sand rounded px-4 py-3 flex flex-wrap justify-between items-center gap-2">
            <div>
              <p className="font-medium">{a.name}</p>
              <p className="text-sm text-ink-muted">
                {a.acquisitionDate} · {formatIDR(a.acquisitionCost)} · {a.usefulLifeMonths} bln
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void disposeAsset(a.id)}
              className="text-sm text-red-700 border border-red-200 rounded px-3 py-1 hover:bg-red-50 disabled:opacity-50"
            >
              Dispose
            </button>
          </li>
        ))}
        {assets.length === 0 && <p className="text-sm text-ink-muted">Belum ada aset tetap.</p>}
      </ul>
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

  useEffect(() => {
    void Promise.all([
      apiJson<{ plans: typeof plans }>("/api/billing/plans"),
      apiJson<typeof subscription>("/api/billing/subscription"),
      apiJson<typeof usage>("/api/billing/usage"),
    ]).then(([p, s, u]) => {
      setPlans(p.plans ?? []);
      setSubscription(s);
      setUsage(u);
    }).catch(() => undefined);
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
    <div className="space-y-8 max-w-2xl">
      <h1 className="font-display text-3xl">Langganan & Billing</h1>

      {trialEnds && (
        <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
          Masa trial berakhir: {new Date(trialEnds).toLocaleDateString("id-ID", { dateStyle: "long" })}
        </section>
      )}

      {subscription && (
        <section className="bg-paper-card border border-sand rounded-lg p-5 space-y-1">
          <h2 className="font-semibold">Paket saat ini</h2>
          <p>Paket: {subscription.planDetails?.name ?? subscription.plan}</p>
          <p>Status: {subscription.subscriptionStatus}</p>
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

      <section className="space-y-3">
        <h2 className="font-semibold">Paket tersedia</h2>
        {plans.map((p) => (
          <div key={p.code} className="bg-paper-card border border-sand rounded-lg p-5 flex flex-wrap justify-between items-center gap-3">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-ink-muted">
                {formatIDR(p.priceMonthly)}/bulan · max {p.maxOrgs} bisnis · {p.maxSeats} kursi
              </p>
            </div>
            <button
              type="button"
              disabled={checkingOut === p.code}
              onClick={() => void checkout(p.code)}
              className="bg-pine text-white rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {checkingOut === p.code ? "Memproses…" : "Berlangganan"}
            </button>
          </div>
        ))}
        {plans.length === 0 && <p className="text-sm text-ink-muted">Memuat paket…</p>}
      </section>
    </div>
  );
}

export function ContactsPage() {
  const orgId = useOrgId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("customer");
  const [list, setList] = useState<{ id: string; name: string; kind: string }[]>([]);

  async function reload() {
    if (!orgId) return;
    const r = await apiJson<{ contacts: typeof list }>("/api/contacts", {}, orgId);
    setList(r.contacts ?? []);
  }

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [orgId]);

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
    <div className="max-w-lg space-y-6">
      <h1 className="font-display text-3xl">Kontak</h1>
      <form onSubmit={onSubmit} className="flex gap-2 flex-wrap">
        <input className="flex-1 rounded border border-sand px-3 py-2" placeholder="Nama" required value={name} onChange={(e) => setName(e.target.value)} />
        <select className="rounded border border-sand px-3 py-2" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="customer">Pelanggan</option>
          <option value="vendor">Supplier</option>
          <option value="lender">Pemberi pinjaman</option>
          <option value="other">Lainnya</option>
        </select>
        <button className="bg-pine text-white rounded px-4 py-2">Tambah</button>
      </form>
      <ul className="text-sm space-y-1">
        {list.map((c) => (
          <li key={c.id}>{c.name} · {c.kind}</li>
        ))}
      </ul>
    </div>
  );
}
