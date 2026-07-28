import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import { loginSchema } from "../../contracts/types.js";
import {
  clearRefreshCookie,
  getRefreshTokenFromCookie,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  setRefreshCookie,
  signAccessToken,
} from "../../lib/tokens.js";
import {
  requirePlatformAdmin,
  toAuthUser,
  type PlatformAuthVariables,
} from "../../middleware/auth.js";

const platformAuth = new Hono<{ Variables: PlatformAuthVariables }>();

platformAuth.post("/login", async (c) => {
  const body = loginSchema.parse(await c.req.json());

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);

  if (!user?.passwordHash || !user.isPlatformAdmin) {
    throw new ApiError("INVALID_CREDENTIALS", "Invalid admin credentials", 401);
  }

  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) {
    throw new ApiError("INVALID_CREDENTIALS", "Invalid admin credentials", 401);
  }

  const accessToken = await signAccessToken({
    userId: user.id,
    email: user.email,
    scope: "platform",
  });
  const refreshTokenId = await issueRefreshToken(user.id, "platform");
  setRefreshCookie(c, refreshTokenId, "platform");

  return c.json({
    accessToken,
    user: toAuthUser(user),
  });
});

platformAuth.post("/refresh", async (c) => {
  const tokenId = getRefreshTokenFromCookie(c, "platform");
  if (!tokenId) {
    throw new ApiError("UNAUTHORIZED", "Missing refresh token", 401);
  }

  try {
    const { userId, newTokenId } = await rotateRefreshToken(tokenId, "platform");
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.isPlatformAdmin) {
      throw new ApiError("FORBIDDEN", "Platform admin access required", 403);
    }

    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      scope: "platform",
    });
    setRefreshCookie(c, newTokenId, "platform");

    return c.json({
      accessToken,
      user: toAuthUser(user),
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("UNAUTHORIZED", "Invalid refresh token", 401);
  }
});

platformAuth.post("/logout", async (c) => {
  const tokenId = getRefreshTokenFromCookie(c, "platform");
  if (tokenId) {
    await revokeRefreshToken(tokenId, "platform");
  }
  clearRefreshCookie(c, "platform");
  return c.json({ ok: true });
});

platformAuth.get("/me", requirePlatformAdmin, async (c) => {
  const { sub } = c.get("admin");
  const [user] = await db.select().from(users).where(eq(users.id, sub)).limit(1);

  if (!user) {
    throw new ApiError("USER_NOT_FOUND", "User not found", 404);
  }

  return c.json({ user: toAuthUser(user) });
});

export default platformAuth;
