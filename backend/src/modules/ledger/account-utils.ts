import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "../../db/index.js";
import {
  accounts,
  documentSequences,
  type documentTypeEnum,
} from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";

type DocumentType = (typeof documentTypeEnum.enumValues)[number];

export const COA_CODES = {
  KAS: "1100",
  PIUTANG: "1300",
  HUTANG_USAHA: "2100",
  HUTANG_BANK: "2200",
  ASET_TETAP: "1500",
  AKUM_PENYUSUTAN: "1510",
  PENDAPATAN: "4100",
  PENDAPATAN_LAIN: "4200",
  BEBAN_PENYUSUTAN: "5200",
  BEBAN_LAIN: "5300",
} as const;

const DEFAULT_PREFIX: Record<DocumentType, string> = {
  invoice: "INV-",
  bill: "BIL-",
  payment: "PY-",
  receipt: "RC-",
  journal: "JV-",
  adjustment: "ADJ-",
  other: "DOC-",
};

export async function getSystemAccountByCode(
  orgId: string,
  code: string,
): Promise<string> {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.code, code)))
    .limit(1);

  if (!account) {
    throw new ApiError(
      "ACCOUNT_NOT_FOUND",
      `System account ${code} not found`,
      404,
    );
  }

  return account.id;
}

export async function getDefaultCashAccount(orgId: string): Promise<string> {
  const [cash] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.isCash, true)))
    .limit(1);

  if (!cash) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "No cash account configured", 404);
  }

  return cash.id;
}

export async function nextDocumentNumber(
  orgId: string,
  documentType: DocumentType,
  tx: DbTransaction,
): Promise<string> {
  const [existing] = await tx
    .select()
    .from(documentSequences)
    .where(
      and(
        eq(documentSequences.orgId, orgId),
        eq(documentSequences.documentType, documentType),
      ),
    )
    .limit(1);

  let seq = existing;

  if (!seq) {
    const [created] = await tx
      .insert(documentSequences)
      .values({
        orgId,
        documentType,
        prefix: DEFAULT_PREFIX[documentType],
        nextNumber: 1,
        padding: 4,
      })
      .returning();
    seq = created!;
  }

  const number = `${seq.prefix}${String(seq.nextNumber).padStart(seq.padding, "0")}`;

  await tx
    .update(documentSequences)
    .set({ nextNumber: seq.nextNumber + 1, updatedAt: new Date() })
    .where(eq(documentSequences.id, seq.id));

  return number;
}

export function parseAmount(amount: number): number {
  const rounded = Math.round(amount * 100) / 100;
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new ApiError("INVALID_AMOUNT", "Amount must be positive", 400);
  }
  return rounded;
}

export function parseDate(date?: string): string {
  const value = date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError("INVALID_DATE", "Date must be YYYY-MM-DD", 400);
  }
  return value;
}
