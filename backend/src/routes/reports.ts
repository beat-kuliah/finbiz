import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";
import { ApiError } from "../lib/errors.js";
import { assertEntitled } from "../modules/entitlements/index.js";
import { getAgingReport } from "../modules/arap/service.js";
import {
  getBalanceSheet,
  getCashFlow,
  getProfitLoss,
  getTrialBalance,
} from "../modules/reports/aggregates.js";

const openItemKindSchema = z.enum(["receivable", "payable"]);

const reports = new Hono<{ Variables: OrgVariables }>();

function parseDateRange(c: { req: { query: (k: string) => string | undefined } }) {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = now.toISOString().slice(0, 10);
  return { from: from ?? defaultFrom, to: to ?? defaultTo };
}

reports.get("/profit-loss", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const { from, to } = parseDateRange(c);
  const breakdown = c.req.query("breakdown") === "true";
  const result = await getProfitLoss(orgId, from, to, breakdown);
  return c.json({ from, to, ...result });
});

reports.get("/balance-sheet", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const asOf = c.req.query("asOf");
  const result = await getBalanceSheet(orgId, asOf);
  return c.json(result);
});

reports.get("/trial-balance", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const asOf = c.req.query("asOf");
  const result = await getTrialBalance(orgId, asOf);
  return c.json(result);
});

reports.get("/cash-flow", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const { from, to } = parseDateRange(c);
  const result = await getCashFlow(orgId, from, to);
  return c.json(result);
});

reports.get("/aging", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const kind = openItemKindSchema.parse(c.req.query("kind") ?? "receivable");

  try {
    await assertEntitled(userId, "export_report");
  } catch (err) {
    if (err instanceof ApiError && err.code !== "NOT_ENTITLED") {
      throw err;
    }
  }

  const result = await getAgingReport(orgId, kind);
  return c.json(result);
});

export default reports;
