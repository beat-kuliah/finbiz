import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { accounts, fiscalPeriods } from "../db/schema.js";
import { ApiError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { assertWritable } from "../modules/entitlements/index.js";
import { postJournal } from "../modules/ledger/journal.js";
import { getProfitLoss } from "../modules/reports/aggregates.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";

const closePeriodSchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const periods = new Hono<{ Variables: OrgVariables }>();

periods.post("/close", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = closePeriodSchema.parse(await c.req.json());

  await assertWritable(userId, orgId);

  const [lastPeriod] = await db
    .select()
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.orgId, orgId))
    .orderBy(desc(fiscalPeriods.endDate))
    .limit(1);

  const startDate =
    lastPeriod?.endDate ??
    `${new Date(body.endDate).getFullYear()}-01-01`;

  if (body.endDate < startDate) {
    throw new ApiError("INVALID_PERIOD", "End date must be after period start", 400);
  }

  const name = `Period ${startDate} — ${body.endDate}`;
  const pl = await getProfitLoss(orgId, startDate, body.endDate);

  let closingJournalId: string | undefined;

  if (Math.abs(pl.netIncome) > 0.001) {
    const orgAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.orgId, orgId));

    const retained = orgAccounts.find((a) => a.code === "3300");
    const revenue = orgAccounts.find((a) => a.code === "4100");
    const expense = orgAccounts.find((a) => a.code === "5100");

    if (retained && revenue && expense && pl.netIncome > 0) {
      try {
        const journal = await postJournal({
          orgId,
          date: new Date(body.endDate),
          description: `Closing entries — ${name}`,
          userId,
          lines: [
            { accountId: revenue.id, debit: pl.netIncome, credit: 0 },
            { accountId: retained.id, debit: 0, credit: pl.netIncome },
          ],
        });
        closingJournalId = journal.entryId;
      } catch {
        // Closing journal optional; period still closes
      }
    } else if (retained && revenue && expense && pl.netIncome < 0) {
      const loss = -pl.netIncome;
      try {
        const journal = await postJournal({
          orgId,
          date: new Date(body.endDate),
          description: `Closing entries (loss) — ${name}`,
          userId,
          lines: [
            { accountId: retained.id, debit: loss, credit: 0 },
            { accountId: expense.id, debit: 0, credit: loss },
          ],
        });
        closingJournalId = journal.entryId;
      } catch {
        // Closing journal optional
      }
    }
  }

  const [period] = await db
    .insert(fiscalPeriods)
    .values({
      orgId,
      name,
      startDate,
      endDate: body.endDate,
      isClosed: true,
    })
    .returning();

  return c.json({
    period: {
      id: period!.id,
      name: period!.name,
      startDate: period!.startDate,
      endDate: period!.endDate,
      isClosed: period!.isClosed,
    },
    closingJournalId,
    netIncome: pl.netIncome,
  });
});

periods.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const rows = await db
    .select()
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.orgId, orgId))
    .orderBy(desc(fiscalPeriods.endDate));

  return c.json({
    periods: rows.map((p) => ({
      id: p.id,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      isClosed: p.isClosed,
    })),
  });
});

export default periods;
