import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { accounts, journalEntries, journalLines } from "../db/schema.js";
import {
  createAccountSchema,
  updateAccountSchema,
} from "../contracts/types.js";
import { ApiError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";
import { assertWritable } from "../modules/entitlements/index.js";

const accountsRoutes = new Hono<{ Variables: OrgVariables }>();

function computeBalance(
  type: string,
  totalDebit: number,
  totalCredit: number,
): number {
  if (type === "asset" || type === "expense") {
    return Math.round(totalDebit - totalCredit);
  }
  return Math.round(totalCredit - totalDebit);
}

accountsRoutes.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");

  const rows = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      isCash: accounts.isCash,
      totalDebit: sql<string>`coalesce(sum(case when ${journalEntries.status} = 'posted' then ${journalLines.debit}::numeric else 0 end), 0)`,
      totalCredit: sql<string>`coalesce(sum(case when ${journalEntries.status} = 'posted' then ${journalLines.credit}::numeric else 0 end), 0)`,
    })
    .from(accounts)
    .leftJoin(journalLines, eq(journalLines.accountId, accounts.id))
    .leftJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(eq(accounts.orgId, orgId))
    .groupBy(accounts.id)
    .orderBy(accounts.code);

  return c.json({
    accounts: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      isCash: row.isCash,
      balance: computeBalance(
        row.type,
        Number(row.totalDebit),
        Number(row.totalCredit),
      ),
    })),
  });
});

accountsRoutes.post("/", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = createAccountSchema.parse(await c.req.json());

  await assertWritable(userId, orgId);

  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.code, body.code)))
    .limit(1);

  if (existing) {
    throw new ApiError("DUPLICATE_CODE", "Account code already exists", 409);
  }

  const [account] = await db
    .insert(accounts)
    .values({
      orgId,
      code: body.code,
      name: body.name,
      type: body.type,
      isCash: body.isCash ?? false,
      isSystem: false,
    })
    .returning();

  return c.json(
    {
      account: {
        id: account!.id,
        code: account!.code,
        name: account!.name,
        type: account!.type,
        isCash: account!.isCash,
        balance: 0,
      },
    },
    201,
  );
});

accountsRoutes.patch("/:id", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const accountId = c.req.param("id");
  const body = updateAccountSchema.parse(await c.req.json());

  await assertWritable(userId, orgId);

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.orgId, orgId)))
    .limit(1);

  if (!account) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "Account not found", 404);
  }

  if (account.isSystem) {
    throw new ApiError("FORBIDDEN", "System accounts cannot be modified", 403);
  }

  if (body.code && body.code !== account.code) {
    const [duplicate] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), eq(accounts.code, body.code)))
      .limit(1);

    if (duplicate) {
      throw new ApiError("DUPLICATE_CODE", "Account code already exists", 409);
    }
  }

  const [updated] = await db
    .update(accounts)
    .set({
      ...(body.code !== undefined ? { code: body.code } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
    })
    .where(eq(accounts.id, accountId))
    .returning();

  return c.json({
    account: {
      id: updated!.id,
      code: updated!.code,
      name: updated!.name,
      type: updated!.type,
      isCash: updated!.isCash,
    },
  });
});

accountsRoutes.get("/:id/ledger", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const accountId = c.req.param("id");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.orgId, orgId)))
    .limit(1);

  if (!account) {
    throw new ApiError("ACCOUNT_NOT_FOUND", "Account not found", 404);
  }

  const conditions = [
    eq(journalLines.accountId, accountId),
    eq(journalEntries.orgId, orgId),
    eq(journalEntries.status, "posted"),
  ];

  if (from) {
    conditions.push(gte(journalEntries.entryDate, from));
  }
  if (to) {
    conditions.push(lte(journalEntries.entryDate, to));
  }

  const rows = await db
    .select({
      id: journalLines.id,
      entryId: journalEntries.id,
      entryDate: journalEntries.entryDate,
      memo: journalEntries.description,
      debit: journalLines.debit,
      credit: journalLines.credit,
      lineDescription: journalLines.description,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(...conditions))
    .orderBy(journalEntries.entryDate, journalLines.lineOrder);

  let runningBalance = 0;

  const lines = rows.map((row) => {
    const debit = Math.round(Number(row.debit));
    const credit = Math.round(Number(row.credit));

    if (account.type === "asset" || account.type === "expense") {
      runningBalance += debit - credit;
    } else {
      runningBalance += credit - debit;
    }

    return {
      id: row.id,
      entryId: row.entryId,
      entryDate: row.entryDate,
      memo: row.memo,
      description: row.lineDescription,
      debit,
      credit,
      balance: runningBalance,
    };
  });

  return c.json({ lines });
});

export default accountsRoutes;
