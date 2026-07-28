import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { documents } from "../db/schema.js";
import { createDocumentSchema } from "../contracts/types.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";
import { assertEntitled, assertWritable } from "../modules/entitlements/index.js";
import {
  createDocument,
  documentToApi,
  type DocumentKind,
} from "../modules/ledger/documents.js";

const documentsRoutes = new Hono<{ Variables: OrgVariables }>();

documentsRoutes.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");

  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.orgId, orgId))
    .orderBy(desc(documents.date), desc(documents.createdAt));

  return c.json({
    documents: rows.map(documentToApi),
  });
});

documentsRoutes.post("/", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = createDocumentSchema.parse(await c.req.json());

  await assertEntitled(userId, "post_journal");
  await assertWritable(userId, orgId);

  const document = await createDocument({
    orgId,
    userId,
    kind: body.kind as DocumentKind,
    amount: body.amount,
    memo: body.memo,
    cashAccountId: body.cashAccountId,
    counterAccountId: body.counterAccountId,
    isPrive: body.isPrive,
    date: body.date,
    dueDate: body.dueDate,
    contactId: body.contactId,
    openItemId: body.openItemId,
    documentId: body.documentId,
  });

  return c.json({ document }, 201);
});

export default documentsRoutes;
