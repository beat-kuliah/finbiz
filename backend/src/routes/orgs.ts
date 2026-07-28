import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import {
  accounts,
  documents,
  journalEntries,
  journalLines,
  memberships,
  organizations,
} from "../db/schema.js";
import { ApiError } from "../lib/errors.js";
import { createOrgSchema } from "../contracts/types.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";
import { assertEntitled, assertWithinLimit } from "../modules/entitlements/index.js";
import {
  getAccountIdByCode,
  seedChartOfAccounts,
} from "../coa/seed.js";
import { postJournal } from "../modules/ledger/journal.js";

const orgs = new Hono<{ Variables: AuthVariables }>();

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base}-${nanoid(6)}`;
}

orgs.get("/", requireAuth, async (c) => {
  const userId = c.get("user").sub;

  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      businessType: organizations.businessType,
      role: memberships.role,
      createdAt: organizations.createdAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, userId));

  return c.json({
    organizations: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      businessType: row.businessType,
      currency: "IDR",
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    })),
    // backward-compatible alias
    orgs: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      businessType: row.businessType,
      currency: "IDR",
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

orgs.post("/", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const body = createOrgSchema.parse(await c.req.json());

  await assertEntitled(userId, "create_org");
  await assertWithinLimit(userId, "max_orgs");

  const slug = slugify(body.name);

  const result = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: body.name,
        slug,
        businessType: body.businessType,
      })
      .returning();

    await tx.insert(memberships).values({
      orgId: org!.id,
      userId,
      role: "owner",
    });

    const codeToId = await seedChartOfAccounts(org!.id, body.businessType, tx);

    return { org, codeToId };
  });

  let openingJournalId: string | undefined;

  if (body.openingCash && body.openingCash > 0) {
    const kasId = getAccountIdByCode(result.codeToId, "1100");
    const modalId = getAccountIdByCode(result.codeToId, "3100");

    if (kasId && modalId) {
      const journal = await postJournal({
        orgId: result.org!.id,
        date: new Date(),
        description: "Saldo awal kas",
        userId,
        lines: [
          { accountId: kasId, debit: body.openingCash, credit: 0 },
          { accountId: modalId, debit: 0, credit: body.openingCash },
        ],
      });
      openingJournalId = journal.entryId;
    }
  }

  return c.json(
    {
      organization: {
        id: result.org!.id,
        name: result.org!.name,
        slug: result.org!.slug,
        businessType: result.org!.businessType,
        currency: "IDR",
        role: "owner",
        createdAt: result.org!.createdAt.toISOString(),
      },
      // backward-compatible alias
      org: {
        id: result.org!.id,
        name: result.org!.name,
        slug: result.org!.slug,
        businessType: result.org!.businessType,
        currency: "IDR",
        role: "owner",
        createdAt: result.org!.createdAt.toISOString(),
      },
      openingJournalId,
    },
    201,
  );
});

orgs.get("/:orgId/export", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.req.param("orgId");

  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);

  if (!membership || membership.role !== "owner") {
    throw new ApiError("FORBIDDEN", "Only organization owners can export data", 403);
  }

  await assertEntitled(userId, "export_report");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) {
    throw new ApiError("NOT_FOUND", "Organization not found", 404);
  }

  const orgAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.orgId, orgId));

  const orgDocuments = await db
    .select()
    .from(documents)
    .where(eq(documents.orgId, orgId));

  const entries = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.orgId, orgId));

  const allLines = [];
  for (const entry of entries) {
    const entryLines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entry.id));
    allLines.push(...entryLines);
  }

  return c.json({
    exportedAt: new Date().toISOString(),
    organization: org,
    accounts: orgAccounts,
    documents: orgDocuments,
    journalEntries: entries,
    journalLines: allLines,
  });
});

orgs.get("/:orgId", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.req.param("orgId");

  const [row] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      businessType: organizations.businessType,
      role: memberships.role,
      createdAt: organizations.createdAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(and(eq(memberships.userId, userId), eq(organizations.id, orgId)))
    .limit(1);

  if (!row) {
    throw new ApiError("NOT_FOUND", "Organization not found", 404);
  }

  return c.json({
    org: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      businessType: row.businessType,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
    },
  });
});

export default orgs;
