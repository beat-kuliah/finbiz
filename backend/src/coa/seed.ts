import { eq } from "drizzle-orm";
import type { DbTransaction } from "../db/index.js";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";

export type BusinessType = "umkm" | "retail" | "service";

interface CoaTemplate {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  isCash?: boolean;
  isSystem?: boolean;
}

const UMKM_COA: CoaTemplate[] = [
  { code: "1100", name: "Kas", type: "asset", isCash: true, isSystem: true },
  { code: "1200", name: "Bank", type: "asset", isCash: true, isSystem: true },
  { code: "1300", name: "Piutang Usaha", type: "asset", isSystem: true },
  { code: "1400", name: "Persediaan", type: "asset", isSystem: true },
  { code: "1500", name: "Aset Tetap", type: "asset", isSystem: true },
  { code: "1510", name: "Akumulasi Penyusutan", type: "asset", isSystem: true },
  { code: "2100", name: "Hutang Usaha", type: "liability", isSystem: true },
  { code: "2200", name: "Hutang Bank", type: "liability", isSystem: true },
  { code: "3100", name: "Modal", type: "equity", isSystem: true },
  { code: "3200", name: "Prive", type: "equity", isSystem: true },
  { code: "3300", name: "Laba Ditahan", type: "equity", isSystem: true },
  { code: "4100", name: "Pendapatan Usaha", type: "revenue", isSystem: true },
  { code: "4200", name: "Pendapatan Lain-lain", type: "revenue", isSystem: true },
  { code: "5100", name: "Beban Operasional", type: "expense", isSystem: true },
  { code: "5200", name: "Beban Penyusutan", type: "expense", isSystem: true },
  { code: "5300", name: "Beban Lain-lain", type: "expense", isSystem: true },
];

const RETAIL_EXTRA: CoaTemplate[] = [
  { code: "1310", name: "Piutang Karyawan", type: "asset", isSystem: true },
  { code: "4110", name: "Pendapatan Penjualan", type: "revenue", isSystem: true },
];

const SERVICE_EXTRA: CoaTemplate[] = [
  { code: "4120", name: "Pendapatan Jasa", type: "revenue", isSystem: true },
  { code: "5110", name: "Beban Gaji", type: "expense", isSystem: true },
];

function templatesForBusinessType(businessType: BusinessType): CoaTemplate[] {
  const base = [...UMKM_COA];
  if (businessType === "retail") base.push(...RETAIL_EXTRA);
  if (businessType === "service") base.push(...SERVICE_EXTRA);
  return base;
}

export async function seedChartOfAccounts(
  orgId: string,
  businessType: BusinessType = "umkm",
  tx?: DbTransaction,
): Promise<Map<string, string>> {
  const runner = tx ?? db;
  const templates = templatesForBusinessType(businessType);
  const codeToId = new Map<string, string>();

  const existing = await runner
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(eq(accounts.orgId, orgId));

  if (existing.length > 0) {
    for (const row of existing) {
      codeToId.set(row.code, row.id);
    }
    return codeToId;
  }

  const inserted = await runner
    .insert(accounts)
    .values(
      templates.map((t) => ({
        orgId,
        code: t.code,
        name: t.name,
        type: t.type,
        isCash: t.isCash ?? false,
        isSystem: t.isSystem ?? false,
      })),
    )
    .returning({ id: accounts.id, code: accounts.code });

  for (const row of inserted) {
    codeToId.set(row.code, row.id);
  }

  return codeToId;
}

export function getAccountIdByCode(
  codeToId: Map<string, string>,
  code: string,
): string | undefined {
  return codeToId.get(code);
}
