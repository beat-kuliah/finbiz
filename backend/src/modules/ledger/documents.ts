import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "../../db/index.js";
import {
  accounts,
  documentSequences,
  documents,
  type documentTypeEnum,
} from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import {
  createInvoice,
  createLoanIn,
  createLoanPayment,
  createReceipt,
} from "../arap/service.js";
import { postJournal, type JournalLineInput } from "./journal.js";

export type DocumentKind =
  | "cash_in"
  | "cash_out"
  | "transfer"
  | "capital"
  | "loan_in"
  | "loan_payment"
  | "invoice"
  | "receipt";

type DocumentType = (typeof documentTypeEnum.enumValues)[number];

const FULLY_IMPLEMENTED_KINDS = new Set<DocumentKind>([
  "cash_in",
  "cash_out",
  "transfer",
  "capital",
]);

const KIND_TO_DOC_TYPE: Record<DocumentKind, DocumentType> = {
  cash_in: "receipt",
  cash_out: "payment",
  transfer: "journal",
  capital: "journal",
  loan_in: "journal",
  loan_payment: "payment",
  invoice: "invoice",
  receipt: "receipt",
};

const DEFAULT_PREFIX: Record<DocumentType, string> = {
  invoice: "INV-",
  bill: "BIL-",
  payment: "PY-",
  receipt: "RC-",
  journal: "JV-",
  adjustment: "ADJ-",
  other: "DOC-",
};

export interface CreateDocumentInput {
  orgId: string;
  userId: string;
  kind: DocumentKind;
  amount: number;
  memo?: string;
  cashAccountId?: string;
  counterAccountId?: string;
  isPrive?: boolean;
  date?: string;
  dueDate?: string;
  contactId?: string;
  openItemId?: string;
  documentId?: string;
}

function parseAmount(amount: number): number {
  const rounded = Math.round(amount);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new ApiError("INVALID_AMOUNT", "Amount must be a positive integer", 400);
  }
  return rounded;
}

function parseDate(date?: string): Date {
  const value = date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError("INVALID_DATE", "Date must be YYYY-MM-DD", 400);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

async function getAccount(
  orgId: string,
  accountId: string,
  label: string,
): Promise<{ id: string; type: string; isCash: boolean; code: string }> {
  const [account] = await db
    .select({
      id: accounts.id,
      type: accounts.type,
      isCash: accounts.isCash,
      code: accounts.code,
    })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.orgId, orgId)))
    .limit(1);

  if (!account) {
    throw new ApiError("ACCOUNT_NOT_FOUND", `${label} account not found`, 404);
  }

  return account;
}

async function getDefaultCashAccount(orgId: string): Promise<string> {
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

async function getSystemAccountByCode(
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

async function nextDocumentNumber(
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

function buildJournalLines(input: CreateDocumentInput & { amount: number }): {
  lines: JournalLineInput[];
  description: string;
} {
  const memo = input.memo?.trim() || defaultMemo(input.kind, input.isPrive);
  const amount = input.amount;

  switch (input.kind) {
    case "cash_in": {
      if (!input.cashAccountId || !input.counterAccountId) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "cashAccountId and counterAccountId are required for cash_in",
          400,
        );
      }
      return {
        description: memo,
        lines: [
          { accountId: input.cashAccountId, debit: amount, credit: 0 },
          { accountId: input.counterAccountId, debit: 0, credit: amount },
        ],
      };
    }
    case "cash_out": {
      if (!input.cashAccountId || !input.counterAccountId) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "cashAccountId and counterAccountId are required for cash_out",
          400,
        );
      }
      return {
        description: memo,
        lines: [
          { accountId: input.counterAccountId, debit: amount, credit: 0 },
          { accountId: input.cashAccountId, debit: 0, credit: amount },
        ],
      };
    }
    case "transfer": {
      if (!input.cashAccountId || !input.counterAccountId) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "cashAccountId (source) and counterAccountId (destination) are required for transfer",
          400,
        );
      }
      return {
        description: memo,
        lines: [
          { accountId: input.counterAccountId, debit: amount, credit: 0 },
          { accountId: input.cashAccountId, debit: 0, credit: amount },
        ],
      };
    }
    case "capital": {
      if (input.isPrive) {
        return {
          description: memo,
          lines: [
            {
              accountId: input.counterAccountId!,
              debit: amount,
              credit: 0,
            },
            { accountId: input.cashAccountId!, debit: 0, credit: amount },
          ],
        };
      }
      return {
        description: memo,
        lines: [
          { accountId: input.cashAccountId!, debit: amount, credit: 0 },
          {
            accountId: input.counterAccountId!,
            debit: 0,
            credit: amount,
          },
        ],
      };
    }
    default:
      throw new ApiError(
        "NOT_IMPLEMENTED",
        `Document kind '${input.kind}' is not implemented yet`,
        501,
      );
  }
}

function defaultMemo(kind: DocumentKind, isPrive?: boolean): string {
  switch (kind) {
    case "cash_in":
      return "Kas masuk";
    case "cash_out":
      return "Kas keluar";
    case "transfer":
      return "Transfer kas";
    case "capital":
      return isPrive ? "Prive" : "Setor modal";
    default:
      return "Transaksi";
  }
}

async function resolveAccounts(input: CreateDocumentInput): Promise<CreateDocumentInput> {
  const resolved = { ...input };

  if (resolved.kind === "capital") {
    resolved.cashAccountId =
      resolved.cashAccountId ?? (await getDefaultCashAccount(resolved.orgId));
    if (resolved.isPrive) {
      resolved.counterAccountId =
        resolved.counterAccountId ??
        (await getSystemAccountByCode(resolved.orgId, "3200"));
    } else {
      resolved.counterAccountId =
        resolved.counterAccountId ??
        (await getSystemAccountByCode(resolved.orgId, "3100"));
    }
    return resolved;
  }

  if (resolved.kind === "transfer") {
    if (!resolved.cashAccountId || !resolved.counterAccountId) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "cashAccountId (source) and counterAccountId (destination) are required for transfer",
        400,
      );
    }
    const source = await getAccount(
      resolved.orgId,
      resolved.cashAccountId,
      "Source",
    );
    const dest = await getAccount(
      resolved.orgId,
      resolved.counterAccountId,
      "Destination",
    );
    if (!source.isCash || !dest.isCash) {
      throw new ApiError(
        "INVALID_ACCOUNT",
        "Transfer requires both accounts to be cash accounts",
        400,
      );
    }
    if (source.id === dest.id) {
      throw new ApiError(
        "INVALID_ACCOUNT",
        "Source and destination must differ",
        400,
      );
    }
    return resolved;
  }

  if (resolved.kind === "cash_in" || resolved.kind === "cash_out") {
    resolved.cashAccountId =
      resolved.cashAccountId ?? (await getDefaultCashAccount(resolved.orgId));
    if (!resolved.counterAccountId) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "counterAccountId is required",
        400,
      );
    }
    const cash = await getAccount(
      resolved.orgId,
      resolved.cashAccountId,
      "Cash",
    );
    if (!cash.isCash) {
      throw new ApiError("INVALID_ACCOUNT", "Cash account must be a cash account", 400);
    }
  }

  return resolved;
}

const ARAP_KINDS = new Set<DocumentKind>([
  "invoice",
  "receipt",
  "loan_in",
  "loan_payment",
]);

export async function createDocument(
  input: CreateDocumentInput,
): Promise<{
  id: string;
  kind: string;
  status: string;
  date: string;
  amount: number;
  memo: string;
  openItemId?: string;
}> {
  if (ARAP_KINDS.has(input.kind)) {
    const arapInput = {
      orgId: input.orgId,
      userId: input.userId,
      amount: input.amount,
      memo: input.memo,
      date: input.date,
      dueDate: input.dueDate,
      contactId: input.contactId,
      openItemId: input.openItemId,
      documentId: input.documentId,
      cashAccountId: input.cashAccountId,
    };

    switch (input.kind) {
      case "invoice":
        return createInvoice(arapInput);
      case "receipt":
        return createReceipt(arapInput);
      case "loan_in":
        return createLoanIn(arapInput);
      case "loan_payment":
        return createLoanPayment(arapInput);
    }
  }

  if (!FULLY_IMPLEMENTED_KINDS.has(input.kind)) {
    throw new ApiError(
      "NOT_IMPLEMENTED",
      `Document kind '${input.kind}' is not implemented yet`,
      501,
    );
  }

  const amount = parseAmount(input.amount);
  const entryDate = parseDate(input.date);
  const resolved = await resolveAccounts(input);
  const documentType = KIND_TO_DOC_TYPE[resolved.kind];
  const { lines, description } = buildJournalLines({ ...resolved, amount });

  const result = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(resolved.orgId, documentType, tx);
    const dateStr = entryDate.toISOString().slice(0, 10);

    const [doc] = await tx
      .insert(documents)
      .values({
        orgId: resolved.orgId,
        type: documentType,
        number,
        contactId: resolved.contactId,
        date: dateStr,
        status: "posted",
        description,
        totalAmount: amount.toFixed(2),
        metadata: {
          kind: resolved.kind,
          isPrive: resolved.isPrive ?? false,
          cashAccountId: resolved.cashAccountId,
          counterAccountId: resolved.counterAccountId,
        },
      })
      .returning();

    const { entryId } = await postJournal({
      orgId: resolved.orgId,
      date: entryDate,
      description,
      lines,
      documentId: doc!.id,
      userId: resolved.userId,
      tx,
    });

    return { doc: doc!, entryId };
  });

  return {
    id: result.doc.id,
    kind: resolved.kind,
    status: result.doc.status,
    date: result.doc.date,
    amount,
    memo: result.doc.description ?? "",
  };
}

export function documentToApi(row: {
  id: string;
  type: string;
  status: string;
  date: string;
  totalAmount: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
}): {
  id: string;
  kind: string;
  status: string;
  date: string;
  amount: number;
  memo: string;
} {
  const metadata = row.metadata ?? {};
  const kind =
    typeof metadata.kind === "string" ? metadata.kind : row.type;

  return {
    id: row.id,
    kind,
    status: row.status,
    date: row.date,
    amount: Math.round(Number(row.totalAmount)),
    memo: row.description ?? "",
  };
}
