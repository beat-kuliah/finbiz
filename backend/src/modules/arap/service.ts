import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "../../db/index.js";
import {
  contacts,
  documents,
  openItems,
  type documentTypeEnum,
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

type DocumentType = (typeof documentTypeEnum.enumValues)[number];
type OpenItemKind = "receivable" | "payable";

export interface ArapDocumentInput {
  orgId: string;
  userId: string;
  amount: number;
  memo?: string;
  date?: string;
  dueDate?: string;
  contactId?: string;
  openItemId?: string;
  documentId?: string;
  cashAccountId?: string;
}

export interface ArapDocumentResult {
  id: string;
  kind: string;
  status: string;
  date: string;
  amount: number;
  memo: string;
  openItemId?: string;
}

const KIND_TO_DOC_TYPE: Record<string, DocumentType> = {
  invoice: "invoice",
  receipt: "receipt",
  loan_in: "journal",
  loan_payment: "payment",
};

function defaultMemo(kind: string): string {
  switch (kind) {
    case "invoice":
      return "Faktur penjualan";
    case "receipt":
      return "Penerimaan piutang";
    case "loan_in":
      return "Penerimaan pinjaman";
    case "loan_payment":
      return "Pembayaran pinjaman";
    default:
      return "Transaksi";
  }
}

async function assertContact(orgId: string, contactId: string): Promise<void> {
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId)))
    .limit(1);

  if (!contact) {
    throw new ApiError("CONTACT_NOT_FOUND", "Contact not found", 404);
  }
}

async function findOpenItem(
  orgId: string,
  type: OpenItemKind,
  input: Pick<ArapDocumentInput, "openItemId" | "documentId">,
): Promise<typeof openItems.$inferSelect> {
  if (input.openItemId) {
    const [item] = await db
      .select()
      .from(openItems)
      .where(
        and(
          eq(openItems.id, input.openItemId),
          eq(openItems.orgId, orgId),
          eq(openItems.type, type),
        ),
      )
      .limit(1);

    if (!item) {
      throw new ApiError("OPEN_ITEM_NOT_FOUND", "Open item not found", 404);
    }
    if (item.status === "closed") {
      throw new ApiError("OPEN_ITEM_CLOSED", "Open item is already closed", 400);
    }
    return item;
  }

  if (input.documentId) {
    const [item] = await db
      .select()
      .from(openItems)
      .where(
        and(
          eq(openItems.documentId, input.documentId),
          eq(openItems.orgId, orgId),
          eq(openItems.type, type),
        ),
      )
      .limit(1);

    if (!item) {
      throw new ApiError(
        "OPEN_ITEM_NOT_FOUND",
        "No open item linked to this document",
        404,
      );
    }
    if (item.status === "closed") {
      throw new ApiError("OPEN_ITEM_CLOSED", "Open item is already closed", 400);
    }
    return item;
  }

  throw new ApiError(
    "VALIDATION_ERROR",
    "openItemId or documentId is required",
    400,
  );
}

function updateOpenItemStatus(
  balance: number,
  original: number,
): "open" | "partial" | "closed" {
  if (balance <= 0.01) return "closed";
  if (balance < original - 0.01) return "partial";
  return "open";
}

async function reduceOpenItem(
  tx: DbTransaction,
  item: typeof openItems.$inferSelect,
  paymentAmount: number,
): Promise<void> {
  const currentBalance = Number(item.balanceAmount);
  if (paymentAmount > currentBalance + 0.01) {
    throw new ApiError(
      "INVALID_AMOUNT",
      "Payment exceeds open item balance",
      400,
    );
  }

  const newBalance = Math.round((currentBalance - paymentAmount) * 100) / 100;
  const original = Number(item.originalAmount);

  await tx
    .update(openItems)
    .set({
      balanceAmount: Math.max(0, newBalance).toFixed(2),
      status: updateOpenItemStatus(newBalance, original),
    })
    .where(eq(openItems.id, item.id));
}

async function createArapDocument(
  kind: "invoice" | "receipt" | "loan_in" | "loan_payment",
  input: ArapDocumentInput,
): Promise<ArapDocumentResult> {
  const amount = parseAmount(input.amount);
  const dateStr = parseDate(input.date);
  const entryDate = new Date(`${dateStr}T00:00:00.000Z`);
  const memo = input.memo?.trim() || defaultMemo(kind);
  const documentType = KIND_TO_DOC_TYPE[kind]!;

  if (input.contactId) {
    await assertContact(input.orgId, input.contactId);
  }

  const kasId = input.cashAccountId ?? (await getDefaultCashAccount(input.orgId));
  const piutangId = await getSystemAccountByCode(input.orgId, COA_CODES.PIUTANG);
  const pendapatanId = await getSystemAccountByCode(
    input.orgId,
    COA_CODES.PENDAPATAN,
  );
  const hutangId = await getSystemAccountByCode(
    input.orgId,
    COA_CODES.HUTANG_BANK,
  );

  let openItemId: string | undefined;
  let openItemToReduce: typeof openItems.$inferSelect | undefined;

  if (kind === "receipt") {
    openItemToReduce = await findOpenItem(input.orgId, "receivable", input);
  } else if (kind === "loan_payment") {
    openItemToReduce = await findOpenItem(input.orgId, "payable", input);
  }

  const result = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(input.orgId, documentType, tx);

    const [doc] = await tx
      .insert(documents)
      .values({
        orgId: input.orgId,
        type: documentType,
        number,
        contactId: input.contactId ?? openItemToReduce?.contactId,
        date: dateStr,
        dueDate: input.dueDate,
        status: "posted",
        description: memo,
        totalAmount: amount.toFixed(2),
        metadata: {
          kind,
          openItemId: input.openItemId,
          sourceDocumentId: input.documentId,
        },
      })
      .returning();

    let lines: Array<{ accountId: string; debit: number; credit: number }>;

    switch (kind) {
      case "invoice":
        lines = [
          { accountId: piutangId, debit: amount, credit: 0 },
          { accountId: pendapatanId, debit: 0, credit: amount },
        ];
        break;
      case "receipt":
        lines = [
          { accountId: kasId, debit: amount, credit: 0 },
          { accountId: piutangId, debit: 0, credit: amount },
        ];
        break;
      case "loan_in":
        lines = [
          { accountId: kasId, debit: amount, credit: 0 },
          { accountId: hutangId, debit: 0, credit: amount },
        ];
        break;
      case "loan_payment":
        lines = [
          { accountId: hutangId, debit: amount, credit: 0 },
          { accountId: kasId, debit: 0, credit: amount },
        ];
        break;
    }

    const { entryId } = await postJournal({
      orgId: input.orgId,
      date: entryDate,
      description: memo,
      lines,
      documentId: doc!.id,
      userId: input.userId,
      tx,
    });
    void entryId;

    if (kind === "invoice" || kind === "loan_in") {
      const [openItem] = await tx
        .insert(openItems)
        .values({
          orgId: input.orgId,
          type: kind === "invoice" ? "receivable" : "payable",
          contactId: input.contactId,
          documentId: doc!.id,
          description: memo,
          originalAmount: amount.toFixed(2),
          balanceAmount: amount.toFixed(2),
          dueDate: input.dueDate,
          status: "open",
        })
        .returning({ id: openItems.id });
      openItemId = openItem!.id;
    }

    if (openItemToReduce) {
      await reduceOpenItem(tx, openItemToReduce, amount);
      openItemId = openItemToReduce.id;
    }

    return doc!;
  });

  return {
    id: result.id,
    kind,
    status: result.status,
    date: result.date,
    amount,
    memo: result.description ?? "",
    openItemId,
  };
}

export function createInvoice(input: ArapDocumentInput): Promise<ArapDocumentResult> {
  return createArapDocument("invoice", input);
}

export function createReceipt(input: ArapDocumentInput): Promise<ArapDocumentResult> {
  return createArapDocument("receipt", input);
}

export function createLoanIn(input: ArapDocumentInput): Promise<ArapDocumentResult> {
  return createArapDocument("loan_in", input);
}

export function createLoanPayment(
  input: ArapDocumentInput,
): Promise<ArapDocumentResult> {
  return createArapDocument("loan_payment", input);
}

export async function listOpenItems(
  orgId: string,
  kind: OpenItemKind,
): Promise<
  Array<{
    id: string;
    type: string;
    contactId: string | null;
    documentId: string | null;
    description: string;
    originalAmount: number;
    balanceAmount: number;
    dueDate: string | null;
    status: string;
    createdAt: string;
  }>
> {
  const rows = await db
    .select()
    .from(openItems)
    .where(and(eq(openItems.orgId, orgId), eq(openItems.type, kind)))
    .orderBy(openItems.dueDate, openItems.createdAt);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    contactId: row.contactId,
    documentId: row.documentId,
    description: row.description,
    originalAmount: Number(row.originalAmount),
    balanceAmount: Number(row.balanceAmount),
    dueDate: row.dueDate,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface AgingBucket {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  total: number;
}

export interface AgingRow {
  contactId: string | null;
  contactName: string | null;
  openItemId: string;
  description: string;
  dueDate: string | null;
  balanceAmount: number;
  bucket: keyof Omit<AgingBucket, "total">;
}

export async function getAgingReport(
  orgId: string,
  kind: OpenItemKind,
): Promise<{ kind: OpenItemKind; buckets: AgingBucket; items: AgingRow[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      id: openItems.id,
      contactId: openItems.contactId,
      contactName: contacts.name,
      description: openItems.description,
      dueDate: openItems.dueDate,
      balanceAmount: openItems.balanceAmount,
    })
    .from(openItems)
    .leftJoin(contacts, eq(openItems.contactId, contacts.id))
    .where(
      and(
        eq(openItems.orgId, orgId),
        eq(openItems.type, kind),
        inArray(openItems.status, ["open", "partial"]),
      ),
    );

  const buckets: AgingBucket = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90plus: 0,
    total: 0,
  };

  const items: AgingRow[] = [];

  for (const row of rows) {
    const balance = Number(row.balanceAmount);
    if (balance <= 0) continue;

    let bucket: keyof Omit<AgingBucket, "total"> = "current";

    if (row.dueDate) {
      const due = new Date(`${row.dueDate}T00:00:00.000Z`);
      const diffDays = Math.floor(
        (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffDays <= 0) {
        bucket = "current";
      } else if (diffDays <= 30) {
        bucket = "days1to30";
      } else if (diffDays <= 60) {
        bucket = "days31to60";
      } else if (diffDays <= 90) {
        bucket = "days61to90";
      } else {
        bucket = "days90plus";
      }
    }

    buckets[bucket] += balance;
    buckets.total += balance;

    items.push({
      contactId: row.contactId,
      contactName: row.contactName,
      openItemId: row.id,
      description: row.description,
      dueDate: row.dueDate,
      balanceAmount: balance,
      bucket,
    });
  }

  for (const key of Object.keys(buckets) as Array<keyof AgingBucket>) {
    buckets[key] = Math.round(buckets[key] * 100) / 100;
  }

  return { kind, buckets, items };
}
