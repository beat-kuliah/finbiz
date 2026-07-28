import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { appSettings, users } from "../db/schema.js";
import { ApiError } from "../lib/errors.js";
import {
  clearRefreshCookie,
  getRefreshTokenFromCookie,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  setRefreshCookie,
  signAccessToken,
} from "../lib/tokens.js";
import { registerSchema, loginSchema } from "../contracts/types.js";
import { requireAuth, toAuthUser, type AuthVariables } from "../middleware/auth.js";

const auth = new Hono<{ Variables: AuthVariables }>();

async function getTrialDays(): Promise<number> {
  const [setting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "trial_days"))
    .limit(1);
  return typeof setting?.value === "number" ? setting.value : 90;
}

auth.post("/register", async (c) => {
  const body = registerSchema.parse(await c.req.json());

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);

  if (existing.length > 0) {
    throw new ApiError("EMAIL_EXISTS", "Email already registered", 409);
  }

  const trialDays = await getTrialDays();
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

  const passwordHash = await bcrypt.hash(body.password, 12);

  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      name: body.name,
      passwordHash,
      plan: "trial",
      subscriptionStatus: "trialing",
      trialEndsAt,
    })
    .returning();

  const accessToken = await signAccessToken({
    userId: user!.id,
    email: user!.email,
    scope: "tenant",
  });
  const refreshTokenId = await issueRefreshToken(user!.id, "tenant");
  setRefreshCookie(c, refreshTokenId, "tenant");

  return c.json({
    accessToken,
    user: toAuthUser(user!),
  });
});

auth.post("/login", async (c) => {
  const body = loginSchema.parse(await c.req.json());

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);

  if (!user?.passwordHash) {
    throw new ApiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  }

  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) {
    throw new ApiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  }

  const accessToken = await signAccessToken({
    userId: user.id,
    email: user.email,
    scope: "tenant",
  });
  const refreshTokenId = await issueRefreshToken(user.id, "tenant");
  setRefreshCookie(c, refreshTokenId, "tenant");

  return c.json({
    accessToken,
    user: toAuthUser(user),
  });
});

auth.post("/refresh", async (c) => {
  const tokenId = getRefreshTokenFromCookie(c, "tenant");
  if (!tokenId) {
    throw new ApiError("UNAUTHORIZED", "Missing refresh token", 401);
  }

  try {
    const { userId, newTokenId } = await rotateRefreshToken(tokenId, "tenant");
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new ApiError("USER_NOT_FOUND", "User not found", 404);
    }

    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      scope: "tenant",
    });
    setRefreshCookie(c, newTokenId, "tenant");

    return c.json({
      accessToken,
      user: toAuthUser(user),
    });
  } catch {
    throw new ApiError("UNAUTHORIZED", "Invalid refresh token", 401);
  }
});

auth.post("/logout", async (c) => {
  const tokenId = getRefreshTokenFromCookie(c, "tenant");
  if (tokenId) {
    await revokeRefreshToken(tokenId, "tenant");
  }
  clearRefreshCookie(c, "tenant");
  return c.json({ ok: true });
});

auth.get("/me", requireAuth, async (c) => {
  const { sub } = c.get("user");
  const [user] = await db.select().from(users).where(eq(users.id, sub)).limit(1);

  if (!user) {
    throw new ApiError("USER_NOT_FOUND", "User not found", 404);
  }

  return c.json({ user: toAuthUser(user) });
});

export default auth;
