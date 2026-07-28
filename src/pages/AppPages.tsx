import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ApiError, apiJson, formatIDR } from "@/lib/api";
import { useAuth } from "@/store/auth";

type Account = { id: string; code: string; name: string; type: string; isCash: boolean };
type Doc = { id: string; kind: string; status: string; date: string; amount: number; memo: string };

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
    const cash = a.accounts?.find((x) => x.isCash);
    const rev = a.accounts?.find((x) => x.type === "revenue");
    const exp = a.accounts?.find((x) => x.type === "expense");
    if (cash) setCashId(cash.id);
    if (kind === "cash_in" && rev) setCounterId(rev.id);
    if (kind === "cash_out" && exp) setCounterId(exp.id);
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
          <div>
            <label className="text-sm">Akun kas/bank</label>
            <select className="w-full rounded border border-sand px-3 py-2" value={cashId} onChange={(e) => setCashId(e.target.value)}>
              {accounts.filter((a) => a.isCash).map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          {kind !== "transfer" && (
            <div>
              <label className="text-sm">Akun lawan</label>
              <select className="w-full rounded border border-sand px-3 py-2" value={counterId} onChange={(e) => setCounterId(e.target.value)}>
                {accounts.filter((a) => !a.isCash).map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
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

function SimpleDocForm({ title, kind, defaults }: { title: string; kind: string; defaults?: Partial<{ isPrive: boolean }> }) {
  const orgId = useOrgId();
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    try {
      await apiJson(
        "/api/documents",
        {
          method: "POST",
          body: JSON.stringify({
            kind,
            amount: Math.round(Number(amount.replace(/\D/g, "")) || 0),
            memo,
            isPrive: defaults?.isPrive,
            date: new Date().toISOString().slice(0, 10),
          }),
        },
        orgId,
      );
      toast.success("Tersimpan");
      setAmount("");
      setMemo("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal");
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <h1 className="font-display text-3xl">{title}</h1>
      <form onSubmit={onSubmit} className="bg-paper-card border border-sand rounded-lg p-5 space-y-3">
        <input className="w-full rounded border border-sand px-3 py-2" placeholder="Nominal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="w-full rounded border border-sand px-3 py-2" placeholder="Keterangan" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <button className="bg-pine text-white rounded px-4 py-2 w-full">Catat</button>
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
      <SimpleDocForm title="Terima hutang / pinjaman" kind="loan_in" />
      <SimpleDocForm title="Bayar hutang" kind="loan_payment" />
    </div>
  );
}

export function ReceivablesPage() {
  return (
    <div className="space-y-10">
      <SimpleDocForm title="Catat piutang (invoice)" kind="invoice" />
      <SimpleDocForm title="Terima pelunasan piutang" kind="receipt" />
    </div>
  );
}

export function CashPage() {
  const orgId = useOrgId();
  const [accounts, setAccounts] = useState<(Account & { /* balance later */ })[]>([]);
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
          <li key={a.id} className="bg-paper-card border border-sand rounded px-4 py-3">
            {a.code} — {a.name}
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
  useEffect(() => {
    if (!orgId) return;
    void apiJson<{ entries: typeof entries }>("/api/journals", {}, orgId).then((r) => setEntries(r.entries ?? []));
  }, [orgId]);
  return (
    <div>
      <h1 className="font-display text-3xl mb-4">Jurnal</h1>
      <ul className="space-y-2 text-sm">
        {entries.map((e) => (
          <li key={e.id} className="border-b border-sand py-2 flex justify-between">
            <span>{String(e.entryDate).slice(0, 10)} · {e.memo || "—"}</span>
            <span className={e.status === "voided" ? "text-red-700" : "text-pine"}>{e.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReportsPage() {
  const orgId = useOrgId();
  const [pl, setPl] = useState<{ totalRevenue: number; totalExpense: number; netIncome: number } | null>(null);
  const [bs, setBs] = useState<{ totalAssets: number; totalLiabilities: number; equityWithIncome: number } | null>(null);
  const [tb, setTb] = useState<{ totalDebit: number; totalCredit: number } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    void Promise.all([
      apiJson<typeof pl>("/api/reports/profit-loss", {}, orgId),
      apiJson<typeof bs>("/api/reports/balance-sheet", {}, orgId),
      apiJson<typeof tb>("/api/reports/trial-balance", {}, orgId),
    ]).then(([a, b, c]) => {
      setPl(a);
      setBs(b);
      setTb(c);
    });
  }, [orgId]);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="font-display text-3xl">Laporan</h1>
      {pl && (
        <section className="bg-paper-card border border-sand rounded-lg p-5">
          <h2 className="font-semibold mb-2">Laba rugi</h2>
          <p>Pendapatan: {formatIDR(pl.totalRevenue)}</p>
          <p>Beban: {formatIDR(pl.totalExpense)}</p>
          <p className="font-semibold mt-1">Laba bersih: {formatIDR(pl.netIncome)}</p>
        </section>
      )}
      {bs && (
        <section className="bg-paper-card border border-sand rounded-lg p-5">
          <h2 className="font-semibold mb-2">Neraca</h2>
          <p>Aset: {formatIDR(bs.totalAssets)}</p>
          <p>Kewajiban: {formatIDR(bs.totalLiabilities)}</p>
          <p>Ekuitas (+ laba): {formatIDR(bs.equityWithIncome)}</p>
        </section>
      )}
      {tb && (
        <section className="bg-paper-card border border-sand rounded-lg p-5">
          <h2 className="font-semibold mb-2">Neraca saldo</h2>
          <p>Total debit: {formatIDR(tb.totalDebit)}</p>
          <p>Total kredit: {formatIDR(tb.totalCredit)}</p>
        </section>
      )}
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
