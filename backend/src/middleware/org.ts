import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db } from "../db/index.js";
import { memberships } from "../db/schema.js";
import { ApiError } from "../lib/errors.js";
import type { AuthVariables } from "./auth.js";

export type OrgVariables = AuthVariables & {
  orgId: string;
  orgRole: "owner" | "admin" | "accountant" | "viewer";
};

export const requireOrg = createMiddleware<{ Variables: OrgVariables }>(
  async (c, next) => {
    const orgId = c.req.header("X-Organization-Id");
    if (!orgId) {
      throw new ApiError("ORG_REQUIRED", "X-Organization-Id header is required", 400);
    }

    const userId = c.get("user").sub;

    const [membership] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .limit(1);

    if (!membership) {
      throw new ApiError("FORBIDDEN", "Not a member of this organization", 403);
    }

    c.set("orgId", orgId);
    c.set("orgRole", membership.role);
    await next();
  },
);

export function requireOrgRole(
  ...roles: Array<"owner" | "admin" | "accountant" | "viewer">
) {
  return createMiddleware<{ Variables: OrgVariables }>(async (c, next) => {
    const role = c.get("orgRole");
    if (!roles.includes(role)) {
      throw new ApiError("FORBIDDEN", "Insufficient organization permissions", 403);
    }
    await next();
  });
}
