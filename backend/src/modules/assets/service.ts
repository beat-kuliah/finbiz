import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  depreciationRuns,
  documents,
  fixedAssets,
} from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import {
  COA_CODES,
  getDefaultCashAccount,
  getSystemAccountByCode,
  nextDocumentNumber,
  parseAmount,
  parseDate,
} from "../ledger/account-utils.js";
import { postJournal } from "../ledger/journal.js";

export interface CreateAssetInput {
  orgId: string;
  userId: string;
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  accountId?: string;
  payWithCash?: boolean;
  cashAccountId?: string;
  memo?: string;
}

export interface AssetResult {
  id: string;
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  accountId: string;
  depreciationAccountId: string | null;
  accumulatedDepreciationAccountId: string | null;
  documentId?: string;
}

function monthlyDepreciation(
  cost: number,
  salvage: number,
  usefulLifeMonths: number,
): number {
  if (usefulLifeMonths <= 0) {
    throw new ApiError(
      "INVALID_ASSET",
      "usefulLifeMonths must be positive",
      400,
    );
  }
  const amount = (cost - salvage) / usefulLifeMonths;
  return Math.round(amount * 100) / 100;
}

function periodDateFromYm(periodYm: string): string {
  if (!/^\d{4}-\d{2}$/.test(periodYm)) {
    throw new ApiError("INVALID_DATE", "periodYm must be YYYY-MM", 400);
  }
  return `${periodYm}-01`;
}

export async function listAssets(orgId: string): Promise<AssetResult[]> {
  const rows = await db
    .select()
    .from(fixedAssets)
    .where(eq(fixedAssets.orgId, orgId))
    .orderBy(fixedAssets.acquisitionDate);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    acquisitionDate: row.acquisitionDate,
    acquisitionCost: Number(row.acquisitionCost),
    salvageValue: Number(row.salvageValue),
    usefulLifeMonths: row.usefulLifeMonths,
    accountId: row.accountId,
    depreciationAccountId: row.depreciationAccountId,
    accumulatedDepreciationAccountId: row.accumulatedDepreciationAccountId,
  }));
}

export async function createAsset(input: CreateAssetInput): Promise<AssetResult> {
  const acquisitionCost = parseAmount(input.acquisitionCost);
  const salvageValue =
    input.salvageValue !== undefined
      ? Math.max(0, Math.round(input.salvageValue * 100) / 100)
      : 0;

  if (salvageValue >= acquisitionCost) {
    throw new ApiError(
      "INVALID_ASSET",
      "Salvage value must be less than acquisition cost",
      400,
    );
  }

  const acquisitionDate = parseDate(input.acquisitionDate);
  const entryDate = new Date(`${acquisitionDate}T00:00:00.000Z`);
  const memo = input.memo?.trim() || `Pembelian aset: ${input.name}`;

  const assetAccountId =
    input.accountId ??
    (await getSystemAccountByCode(input.orgId, COA_CODES.ASET_TETAP));
  const depExpenseId = await getSystemAccountByCode(
    input.orgId,
    COA_CODES.BEBAN_PENYUSUTAN,
  );
  const accDepId = await getSystemAccountByCode(
    input.orgId,
    COA_CODES.AKUM_PENYUSUTAN,
  );

  const payWithCash = input.payWithCash !== false;
  const creditAccountId = payWithCash
    ? (input.cashAccountId ?? (await getDefaultCashAccount(input.orgId)))
    : await getSystemAccountByCode(input.orgId, COA_CODES.HUTANG_USAHA);

  const result = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(input.orgId, "other", tx);

    const [doc] = await tx
      .insert(documents)
      .values({
        orgId: input.orgId,
        type: "other",
        number,
        date: acquisitionDate,
        status: "posted",
        description: memo,
        totalAmount: acquisitionCost.toFixed(2),
        metadata: { kind: "asset_purchase", assetName: input.name },
      })
      .returning();

    await postJournal({
      orgId: input.orgId,
      date: entryDate,
      description: memo,
      lines: [
        { accountId: assetAccountId, debit: acquisitionCost, credit: 0 },
        { accountId: creditAccountId, debit: 0, credit: acquisitionCost },
      ],
      documentId: doc!.id,
      userId: input.userId,
      tx,
    });

    const [asset] = await tx
      .insert(fixedAssets)
      .values({
        orgId: input.orgId,
        accountId: assetAccountId,
        depreciationAccountId: depExpenseId,
        accumulatedDepreciationAccountId: accDepId,
        name: input.name,
        acquisitionDate,
        acquisitionCost: acquisitionCost.toFixed(2),
        salvageValue: salvageValue.toFixed(2),
        usefulLifeMonths: input.usefulLifeMonths,
      })
      .returning();

    return { asset: asset!, documentId: doc!.id };
  });

  return {
    id: result.asset.id,
    name: result.asset.name,
    acquisitionDate: result.asset.acquisitionDate,
    acquisitionCost: Number(result.asset.acquisitionCost),
    salvageValue: Number(result.asset.salvageValue),
    usefulLifeMonths: result.asset.usefulLifeMonths,
    accountId: result.asset.accountId,
    depreciationAccountId: result.asset.depreciationAccountId,
    accumulatedDepreciationAccountId: result.asset.accumulatedDepreciationAccountId,
    documentId: result.documentId,
  };
}

export async function runDepreciation(
  orgId: string,
  userId: string,
  periodYm: string,
): Promise<{
  periodYm: string;
  processed: number;
  skipped: number;
  runs: Array<{ assetId: string; assetName: string; amount: number; entryId: string }>;
}> {
  const periodDate = periodDateFromYm(periodYm);
  const entryDate = new Date(`${periodDate}T00:00:00.000Z`);

  const assets = await db
    .select()
    .from(fixedAssets)
    .where(eq(fixedAssets.orgId, orgId));

  const runs: Array<{
    assetId: string;
    assetName: string;
    amount: number;
    entryId: string;
  }> = [];
  let skipped = 0;

  for (const asset of assets) {
    const [existingRun] = await db
      .select({ id: depreciationRuns.id })
      .from(depreciationRuns)
      .where(
        and(
          eq(depreciationRuns.fixedAssetId, asset.id),
          eq(depreciationRuns.periodDate, periodDate),
        ),
      )
      .limit(1);

    if (existingRun) {
      skipped += 1;
      continue;
    }

    const cost = Number(asset.acquisitionCost);
    const salvage = Number(asset.salvageValue);
    const amount = monthlyDepreciation(cost, salvage, asset.usefulLifeMonths);

    if (amount <= 0) {
      skipped += 1;
      continue;
    }

    const depExpenseId =
      asset.depreciationAccountId ??
      (await getSystemAccountByCode(orgId, COA_CODES.BEBAN_PENYUSUTAN));
    const accDepId =
      asset.accumulatedDepreciationAccountId ??
      (await getSystemAccountByCode(orgId, COA_CODES.AKUM_PENYUSUTAN));

    const memo = `Penyusutan ${asset.name} — ${periodYm}`;

    const { entryId } = await postJournal({
      orgId,
      date: entryDate,
      description: memo,
      lines: [
        { accountId: depExpenseId, debit: amount, credit: 0 },
        { accountId: accDepId, debit: 0, credit: amount },
      ],
      userId,
    });

    await db.insert(depreciationRuns).values({
      orgId,
      fixedAssetId: asset.id,
      journalEntryId: entryId,
      periodDate,
      amount: amount.toFixed(2),
    });

    runs.push({
      assetId: asset.id,
      assetName: asset.name,
      amount,
      entryId,
    });
  }

  return {
    periodYm,
    processed: runs.length,
    skipped,
    runs,
  };
}

export async function disposeAsset(
  orgId: string,
  userId: string,
  assetId: string,
  input: { proceeds?: number; date?: string; memo?: string },
): Promise<{ assetId: string; entryId: string; documentId: string }> {
  const [asset] = await db
    .select()
    .from(fixedAssets)
    .where(and(eq(fixedAssets.id, assetId), eq(fixedAssets.orgId, orgId)))
    .limit(1);

  if (!asset) {
    throw new ApiError("ASSET_NOT_FOUND", "Fixed asset not found", 404);
  }

  const proceeds =
    input.proceeds !== undefined
      ? Math.max(0, Math.round(input.proceeds * 100) / 100)
      : 0;
  const dateStr = parseDate(input.date);
  const entryDate = new Date(`${dateStr}T00:00:00.000Z`);
  const memo = input.memo?.trim() || `Disposal aset: ${asset.name}`;

  const cost = Number(asset.acquisitionCost);

  const [accDepRow] = await db
    .select({
      total: sql<string>`coalesce(sum(${depreciationRuns.amount}::numeric), 0)`,
    })
    .from(depreciationRuns)
    .where(eq(depreciationRuns.fixedAssetId, assetId));

  const accumulated = Number(accDepRow?.total ?? 0);
  const bookValue = Math.round((cost - accumulated) * 100) / 100;
  const gainLoss = Math.round((proceeds - bookValue) * 100) / 100;

  const kasId = await getDefaultCashAccount(orgId);
  const accDepId =
    asset.accumulatedDepreciationAccountId ??
    (await getSystemAccountByCode(orgId, COA_CODES.AKUM_PENYUSUTAN));

  const lines: Array<{ accountId: string; debit: number; credit: number }> = [];

  if (proceeds > 0) {
    lines.push({ accountId: kasId, debit: proceeds, credit: 0 });
  }
  if (accumulated > 0) {
    lines.push({ accountId: accDepId, debit: accumulated, credit: 0 });
  }

  lines.push({ accountId: asset.accountId, debit: 0, credit: cost });

  if (gainLoss > 0) {
    const gainId = await getSystemAccountByCode(orgId, COA_CODES.PENDAPATAN_LAIN);
    lines.push({ accountId: gainId, debit: 0, credit: gainLoss });
  } else if (gainLoss < 0) {
    const lossId = await getSystemAccountByCode(orgId, COA_CODES.BEBAN_LAIN);
    lines.push({ accountId: lossId, debit: Math.abs(gainLoss), credit: 0 });
  }

  const result = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(orgId, "other", tx);

    const [doc] = await tx
      .insert(documents)
      .values({
        orgId,
        type: "other",
        number,
        date: dateStr,
        status: "posted",
        description: memo,
        totalAmount: proceeds.toFixed(2),
        metadata: { kind: "asset_disposal", assetId },
      })
      .returning();

    const { entryId } = await postJournal({
      orgId,
      date: entryDate,
      description: memo,
      lines,
      documentId: doc!.id,
      userId,
      tx,
    });

    await tx.delete(fixedAssets).where(eq(fixedAssets.id, assetId));

    return { entryId, documentId: doc!.id };
  });

  return { assetId, ...result };
}
