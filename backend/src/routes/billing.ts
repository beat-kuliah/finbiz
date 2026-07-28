import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { licenseKeys, users } from "../db/schema.js";
import { ApiError } from "../lib/errors.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";
import {
  cancelSubscription,
  changePlan,
  createCheckout,
  getActivePlans,
  getUsage,
  getUserSubscription,
  handleMidtransWebhook,
  isLicenseFeatureEnabled,
  listInvoices,
  verifyLicenseKey,
} from "../modules/billing/index.js";

const billing = new Hono<{ Variables: AuthVariables }>();

const checkoutSchema = z.object({
  planCode: z.string().min(1),
  interval: z.enum(["monthly", "yearly"]),
});

const changePlanSchema = z.object({
  planCode: z.string().min(1),
});

const activateLicenseSchema = z.object({
  key: z.string().min(1),
});

billing.get("/plans", async () => {
  const plans = await getActivePlans();
  return Response.json({
    plans: plans.map((p) => ({
      code: p.code,
      name: p.name,
      priceMonthly: Number(p.priceMonthly),
      priceYearly: Number(p.priceYearly),
      maxOrgs: p.maxOrgs,
      maxSeats: p.maxSeats,
      features: p.features,
    })),
  });
});

billing.get("/subscription", requireAuth, async (c) => {
  const userId = c.get("user").sub;
  const { user, subscription, plan } = await getUserSubscription(userId);
  return c.json({
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt?.toISOString() ?? null,
    subscription: subscription
      ? {
          id: subscription.id,
          planCode: subscription.planCode,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          canceledAt: subscription.canceledAt?.toISOString() ?? null,
        }
      : null,
    planDetails: plan
      ? {
          code: plan.code,
          name: plan.name,
          maxOrgs: plan.maxOrgs,
          maxSeats: plan.maxSeats,
          features: plan.features,
        }
      : null,
  });
});

billing.get("/usage", requireAuth, async (c) => {
  const usage = await getUsage(c.get("user").sub);
  return c.json(usage);
});

billing.post("/checkout", requireAuth, async (c) => {
  const body = checkoutSchema.parse(await c.req.json());
  const result = await createCheckout({
    userId: c.get("user").sub,
    planCode: body.planCode,
    interval: body.interval,
  });
  return c.json(result);
});

billing.post("/webhook/midtrans", async (c) => {
  const payload = (await c.req.json()) as Record<string, unknown>;
  const result = await handleMidtransWebhook(payload);
  return c.json(result);
});

billing.post("/cancel", requireAuth, async (c) => {
  const result = await cancelSubscription(c.get("user").sub);
  return c.json(result);
});

billing.post("/change-plan", requireAuth, async (c) => {
  const body = changePlanSchema.parse(await c.req.json());
  const result = await changePlan(c.get("user").sub, body.planCode);
  return c.json(result);
});

billing.get("/invoices", requireAuth, async (c) => {
  const invoices = await listInvoices(c.get("user").sub);
  return c.json({ invoices });
});

const license = new Hono<{ Variables: AuthVariables }>();

license.post("/activate", requireAuth, async (c) => {
  if (!isLicenseFeatureEnabled()) {
    throw new ApiError("LICENSE_DISABLED", "License activation is not enabled", 403);
  }

  const userId = c.get("user").sub;
  const body = activateLicenseSchema.parse(await c.req.json());
  const decoded = verifyLicenseKey(body.key);

  if (!decoded) {
    throw new ApiError("INVALID_LICENSE", "Invalid license key", 400);
  }

  if (decoded.expiresAt && new Date(decoded.expiresAt) < new Date()) {
    throw new ApiError("LICENSE_EXPIRED", "License key has expired", 400);
  }

  const [existing] = await db
    .select()
    .from(licenseKeys)
    .where(eq(licenseKeys.key, body.key))
    .limit(1);

  if (existing?.activatedByUserId && existing.activatedByUserId !== userId) {
    throw new ApiError("LICENSE_IN_USE", "License key already activated", 409);
  }

  if (!existing) {
    await db.insert(licenseKeys).values({
      key: body.key,
      planCode: decoded.planCode,
      maxOrgs: decoded.maxOrgs,
      maxSeats: decoded.maxSeats,
      activatedByUserId: userId,
      activatedAt: new Date(),
      expiresAt: decoded.expiresAt ? new Date(decoded.expiresAt) : null,
    });
  } else {
    await db
      .update(licenseKeys)
      .set({ activatedByUserId: userId, activatedAt: new Date() })
      .where(eq(licenseKeys.id, existing.id));
  }

  await db
    .update(users)
    .set({ plan: decoded.planCode, subscriptionStatus: "active" })
    .where(eq(users.id, userId));

  return c.json({ ok: true, plan: decoded.planCode });
});

license.get("/status", requireAuth, async (c) => {
  if (!isLicenseFeatureEnabled()) {
    return c.json({ enabled: false, activated: false });
  }

  const userId = c.get("user").sub;
  const [key] = await db
    .select()
    .from(licenseKeys)
    .where(and(eq(licenseKeys.activatedByUserId, userId)))
    .limit(1);

  return c.json({
    enabled: true,
    activated: Boolean(key),
    license: key
      ? {
          planCode: key.planCode,
          maxOrgs: key.maxOrgs,
          maxSeats: key.maxSeats,
          expiresAt: key.expiresAt?.toISOString() ?? null,
          activatedAt: key.activatedAt?.toISOString() ?? null,
        }
      : null,
  });
});

export { billing, license };
