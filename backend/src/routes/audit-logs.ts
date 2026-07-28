import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";

const auditLogsRoute = new Hono<{ Variables: OrgVariables }>();

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

auditLogsRoute.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const { limit } = querySchema.parse({
    limit: c.req.query("limit"),
  });

  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.orgId, orgId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return c.json({
    logs: rows.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata,
      userId: log.userId,
      createdAt: log.createdAt.toISOString(),
    })),
  });
});

export default auditLogsRoute;
