import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";
import { assertEntitled, assertWritable } from "../modules/entitlements/index.js";
import {
  createInvoice,
  createLoanIn,
  createLoanPayment,
  createReceipt,
  listOpenItems,
} from "../modules/arap/service.js";

const openItemKindSchema = z.enum(["receivable", "payable"]);

const arapDocumentSchema = z.object({
  amount: z.number().positive(),
  memo: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  contactId: z.string().uuid().optional(),
  cashAccountId: z.string().uuid().optional(),
});

const receiptSchema = arapDocumentSchema.extend({
  openItemId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
}).refine((data) => data.openItemId || data.documentId, {
  message: "openItemId or documentId is required",
});

const loanPaymentSchema = receiptSchema;

const arapRoutes = new Hono<{ Variables: OrgVariables }>();

arapRoutes.get("/open-items", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const kind = openItemKindSchema.parse(c.req.query("kind") ?? "receivable");

  const items = await listOpenItems(orgId, kind);
  return c.json({ kind, openItems: items });
});

arapRoutes.post("/invoice", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = arapDocumentSchema.parse(await c.req.json());

  await assertEntitled(userId, "post_journal");
  await assertWritable(userId, orgId);

  const document = await createInvoice({ orgId, userId, ...body });
  return c.json({ document }, 201);
});

arapRoutes.post("/receipt", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = receiptSchema.parse(await c.req.json());

  await assertEntitled(userId, "post_journal");
  await assertWritable(userId, orgId);

  const document = await createReceipt({ orgId, userId, ...body });
  return c.json({ document }, 201);
});

arapRoutes.post("/loan-in", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = arapDocumentSchema.parse(await c.req.json());

  await assertEntitled(userId, "post_journal");
  await assertWritable(userId, orgId);

  const document = await createLoanIn({ orgId, userId, ...body });
  return c.json({ document }, 201);
});

arapRoutes.post("/loan-payment", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = loanPaymentSchema.parse(await c.req.json());

  await assertEntitled(userId, "post_journal");
  await assertWritable(userId, orgId);

  const document = await createLoanPayment({ orgId, userId, ...body });
  return c.json({ document }, 201);
});

export default arapRoutes;
