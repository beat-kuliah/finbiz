import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "../../db/index.js";
import {
  accounts,
  journalEntries,
  journalLines,
} from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";

export interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface PostJournalInput {
  orgId: string;
  date: Date;
  description: string;
  lines: JournalLineInput[];
  documentId?: string;
  userId?: string;
  tx?: DbTransaction;
}

const AMOUNT_TOLERANCE = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function validateBalanced(lines: JournalLineInput[]): void {
  if (lines.length < 2) {
    throw new ApiError(
      "JOURNAL_UNBALANCED",
      "Journal must have at least two lines",
      400,
    );
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    if (line.debit < 0 || line.credit < 0) {
      throw new ApiError(
        "INVALID_AMOUNT",
        "Debit and credit amounts must be non-negative",
        400,
      );
    }
    if (line.debit > 0 && line.credit > 0) {
      throw new ApiError(
        "INVALID_LINE",
        "A line cannot have both debit and credit",
        400,
      );
    }
    if (line.debit === 0 && line.credit === 0) {
      throw new ApiError(
        "INVALID_LINE",
        "A line must have either debit or credit",
        400,
      );
    }
    totalDebit += line.debit;
    totalCredit += line.credit;
  }

  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);

  if (Math.abs(totalDebit - totalCredit) > AMOUNT_TOLERANCE) {
    throw new ApiError(
      "JOURNAL_UNBALANCED",
      `Debits (${totalDebit}) must equal credits (${totalCredit})`,
      400,
    );
  }
}

async function insertJournalEntry(
  input: PostJournalInput,
  tx: DbTransaction,
): Promise<{ entryId: string }> {
  const entryDate = input.date.toISOString().slice(0, 10);

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      orgId: input.orgId,
      documentId: input.documentId,
      entryDate,
      description: input.description,
      status: "posted",
      postedAt: new Date(),
      createdBy: input.userId,
    })
    .returning({ id: journalEntries.id });

  await tx.insert(journalLines).values(
    input.lines.map((line, index) => ({
      entryId: entry!.id,
      accountId: line.accountId,
      debit: line.debit.toFixed(2),
      credit: line.credit.toFixed(2),
      description: line.description,
      lineOrder: index,
    })),
  );

  return { entryId: entry!.id };
}

export async function postJournal(
  input: PostJournalInput,
): Promise<{ entryId: string }> {
  validateBalanced(input.lines);

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const runner = input.tx ?? db;
  const foundAccounts = await runner
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.orgId, input.orgId));

  const foundIds = new Set(foundAccounts.map((a) => a.id));
  for (const id of accountIds) {
    if (!foundIds.has(id)) {
      throw new ApiError(
        "ACCOUNT_NOT_FOUND",
        `Account ${id} not found in organization`,
        404,
      );
    }
  }

  if (input.tx) {
    return insertJournalEntry(input, input.tx);
  }

  return db.transaction(async (tx) => insertJournalEntry(input, tx));
}

export async function voidJournal(
  entryId: string,
  orgId: string,
): Promise<void> {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId)),
    )
    .limit(1);

  if (!entry) {
    throw new ApiError("JOURNAL_NOT_FOUND", "Journal entry not found", 404);
  }

  if (entry.status === "void") {
    throw new ApiError("JOURNAL_ALREADY_VOID", "Journal entry already voided", 400);
  }

  if (entry.status !== "posted") {
    throw new ApiError(
      "JOURNAL_NOT_POSTED",
      "Only posted entries can be voided",
      400,
    );
  }

  await db
    .update(journalEntries)
    .set({ status: "void", voidedAt: new Date() })
    .where(eq(journalEntries.id, entryId));
}
