import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { ApiError } from "../lib/errors.js";
import {
  getBearerToken,
  verifyAccessToken,
  type AccessTokenPayload,
} from "../lib/tokens.js";

export type AuthVariables = {
  user: AccessTokenPayload;
};

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const token = getBearerToken(c);
    if (!token) {
      throw new ApiError("UNAUTHORIZED", "Missing access token", 401);
    }

    try {
      const payload = await verifyAccessToken(token);
      if (payload.scope !== "tenant") {
        throw new ApiError("UNAUTHORIZED", "Invalid token scope", 401);
      }
      c.set("user", payload);
      await next();
    } catch {
      throw new ApiError("UNAUTHORIZED", "Invalid or expired access token", 401);
    }
  },
);

export type PlatformAuthVariables = {
  admin: AccessTokenPayload;
};

export const requirePlatformAdmin = createMiddleware<{
  Variables: PlatformAuthVariables;
}>(async (c, next) => {
  const token = getBearerToken(c);
  if (!token) {
    throw new ApiError("UNAUTHORIZED", "Missing access token", 401);
  }

  try {
    const payload = await verifyAccessToken(token);
    if (payload.scope !== "platform") {
      throw new ApiError("UNAUTHORIZED", "Invalid token scope", 401);
    }

    const [user] = await db
      .select({ isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user?.isPlatformAdmin) {
      throw new ApiError("FORBIDDEN", "Platform admin access required", 403);
    }

    c.set("admin", payload);
    await next();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("UNAUTHORIZED", "Invalid or expired access token", 401);
  }
});

export function toAuthUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt?.toISOString() ?? null,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}
