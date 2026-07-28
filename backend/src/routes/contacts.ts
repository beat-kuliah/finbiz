import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import { contacts } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";
import { assertWritable } from "../modules/entitlements/index.js";

const contactKindSchema = z.enum(["customer", "vendor", "lender", "other"]);

const createContactBodySchema = z.object({
  name: z.string().min(1),
  kind: contactKindSchema.default("customer"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  address: z.string().optional(),
});

const contactsRoutes = new Hono<{ Variables: OrgVariables }>();

contactsRoutes.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");

  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, orgId))
    .orderBy(contacts.name);

  return c.json({
    contacts: rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.type,
      email: row.email,
      phone: row.phone,
      taxId: row.taxId,
      address: row.address,
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

contactsRoutes.post("/", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = createContactBodySchema.parse(await c.req.json());

  await assertWritable(userId, orgId);

  const [contact] = await db
    .insert(contacts)
    .values({
      orgId,
      name: body.name,
      type: body.kind,
      email: body.email,
      phone: body.phone,
      taxId: body.taxId,
      address: body.address,
    })
    .returning();

  return c.json(
    {
      contact: {
        id: contact!.id,
        name: contact!.name,
        kind: contact!.type,
        email: contact!.email,
        phone: contact!.phone,
        taxId: contact!.taxId,
        address: contact!.address,
        createdAt: contact!.createdAt.toISOString(),
      },
    },
    201,
  );
});

export default contactsRoutes;
