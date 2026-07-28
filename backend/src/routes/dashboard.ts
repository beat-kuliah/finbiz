import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { memberships, organizations } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";
import { getDashboardMetrics } from "../modules/reports/aggregates.js";

const dashboard = new Hono<{ Variables: OrgVariables }>();

dashboard.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const metrics = await getDashboardMetrics(orgId);
  return c.json(metrics);
});

dashboard.get("/consolidated", requireAuth, async (c) => {
  const userId = c.get("user").sub;

  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, userId));

  const organizationsMetrics = await Promise.all(
    orgs.map(async (org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      ...(await getDashboardMetrics(org.id)),
    })),
  );

  const totals = organizationsMetrics.reduce(
    (acc, m) => ({
      cash: acc.cash + m.cash,
      periodRevenue: acc.periodRevenue + m.periodRevenue,
      periodNetIncome: acc.periodNetIncome + m.periodNetIncome,
      receivables: acc.receivables + m.receivables,
      payables: acc.payables + m.payables,
      equity: acc.equity + m.equity,
    }),
    {
      cash: 0,
      periodRevenue: 0,
      periodNetIncome: 0,
      receivables: 0,
      payables: 0,
      equity: 0,
    },
  );

  return c.json({ organizations: organizationsMetrics, totals });
});

export default dashboard;
