import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  accounts,
  journalEntries,
  journalLines,
} from "../db/schema.js";
import { ApiError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";
import { assertWritable } from "../modules/entitlements/index.js";
import { voidJournal } from "../modules/ledger/journal.js";

const journalsRoutes = new Hono<{ Variables: OrgVariables }>();

function mapJournalStatus(status: string): string {
  return status === "void" ? "voided" : status;
}

journalsRoutes.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");

  const rows = await db
    .select({
      id: journalEntries.id,
      entryDate: journalEntries.entryDate,
      memo: journalEntries.description,
      status: journalEntries.status,
    })
    .from(journalEntries)
    .where(eq(journalEntries.orgId, orgId))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt));

  return c.json({
    entries: rows.map((row) => ({
      id: row.id,
      entryDate: row.entryDate,
      memo: row.memo,
      status: mapJournalStatus(row.status),
    })),
  });
});

journalsRoutes.get("/:id", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const entryId = c.req.param("id");

  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId)))
    .limit(1);

  if (!entry) {
    throw new ApiError("JOURNAL_NOT_FOUND", "Journal entry not found", 404);
  }

  const lines = await db
    .select({
      id: journalLines.id,
      accountId: journalLines.accountId,
      accountCode: accounts.code,
      accountName: accounts.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
      description: journalLines.description,
      lineOrder: journalLines.lineOrder,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entryId))
    .orderBy(journalLines.lineOrder);

  return c.json({
    entry: {
      id: entry.id,
      entryDate: entry.entryDate,
      memo: entry.description,
      status: mapJournalStatus(entry.status),
      documentId: entry.documentId,
      postedAt: entry.postedAt?.toISOString() ?? null,
      voidedAt: entry.voidedAt?.toISOString() ?? null,
    },
    lines: lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      debit: Math.round(Number(line.debit)),
      credit: Math.round(Number(line.credit)),
      description: line.description,
      lineOrder: line.lineOrder,
    })),
  });
});

journalsRoutes.post("/:id/void", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const entryId = c.req.param("id");

  await assertWritable(userId, orgId);
  await voidJournal(entryId, orgId);

  return c.json({ ok: true });
});

export default journalsRoutes;
