import { Hono } from "hono";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  appSettings,
  billingEvents,
  licenseKeys,
  planCatalog,
  subscriptions,
  users,
} from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import { requirePlatformAdmin, type PlatformAuthVariables } from "../../middleware/auth.js";
import {
  generateLicenseKey,
} from "../../modules/billing/index.js";
import { sendTestEmail } from "../../modules/mail/index.js";

const platform = new Hono<{ Variables: PlatformAuthVariables }>();

platform.use("*", requirePlatformAdmin);

platform.get("/overview", async (c) => {
  const [[userCount], [subCount], [eventCount], [licenseCount]] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(subscriptions),
    db.select({ value: count() }).from(billingEvents),
    db.select({ value: count() }).from(licenseKeys),
  ]);

  const [trialSetting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "trial_days"))
    .limit(1);

  return c.json({
    users: userCount?.value ?? 0,
    subscriptions: subCount?.value ?? 0,
    billingEvents: eventCount?.value ?? 0,
    licenses: licenseCount?.value ?? 0,
    trialDays: typeof trialSetting?.value === "number" ? trialSetting.value : 90,
  });
});

platform.get("/users", async (c) => {
  const rows = await db
    .select()
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(200);

  return c.json({
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      plan: u.plan,
      subscriptionStatus: u.subscriptionStatus,
      trialEndsAt: u.trialEndsAt?.toISOString() ?? null,
      isPlatformAdmin: u.isPlatformAdmin,
      createdAt: u.createdAt.toISOString(),
    })),
  });
});

platform.get("/subscriptions", async (c) => {
  const rows = await db
    .select({
      id: subscriptions.id,
      userId: subscriptions.userId,
      planCode: subscriptions.planCode,
      status: subscriptions.status,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      canceledAt: subscriptions.canceledAt,
      createdAt: subscriptions.createdAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(subscriptions)
    .innerJoin(users, eq(subscriptions.userId, users.id))
    .orderBy(desc(subscriptions.createdAt))
    .limit(200);

  return c.json({
    subscriptions: rows.map((s) => ({
      id: s.id,
      userId: s.userId,
      userEmail: s.userEmail,
      userName: s.userName,
      planCode: s.planCode,
      status: s.status,
      currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      canceledAt: s.canceledAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

platform.get("/billing-events", async (c) => {
  const rows = await db
    .select({
      id: billingEvents.id,
      userId: billingEvents.userId,
      subscriptionId: billingEvents.subscriptionId,
      type: billingEvents.type,
      amount: billingEvents.amount,
      metadata: billingEvents.metadata,
      createdAt: billingEvents.createdAt,
      userEmail: users.email,
    })
    .from(billingEvents)
    .innerJoin(users, eq(billingEvents.userId, users.id))
    .orderBy(desc(billingEvents.createdAt))
    .limit(200);

  return c.json({
    events: rows.map((e) => ({
      id: e.id,
      userId: e.userId,
      userEmail: e.userEmail,
      subscriptionId: e.subscriptionId,
      type: e.type,
      amount: e.amount ? Number(e.amount) : null,
      metadata: e.metadata,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

const settingsSchema = z.object({
  trial_days: z.number().int().positive().optional(),
});

platform.get("/settings", async (c) => {
  const rows = await db.select().from(appSettings);
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return c.json({ settings });
});

platform.put("/settings", async (c) => {
  const body = settingsSchema.parse(await c.req.json());

  if (body.trial_days !== undefined) {
    await db
      .insert(appSettings)
      .values({ key: "trial_days", value: body.trial_days })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: body.trial_days, updatedAt: new Date() },
      });
  }

  const [trialSetting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "trial_days"))
    .limit(1);

  return c.json({
    settings: {
      trial_days:
        typeof trialSetting?.value === "number" ? trialSetting.value : 90,
    },
  });
});

const testEmailSchema = z.object({
  to: z.string().email(),
});

platform.post("/settings/test-email", async (c) => {
  const body = testEmailSchema.parse(await c.req.json());
  await sendTestEmail(body.to);
  return c.json({ ok: true });
});

platform.get("/plans", async (c) => {
  const plans = await db.select().from(planCatalog).orderBy(planCatalog.code);
  return c.json({
    plans: plans.map((p) => ({
      code: p.code,
      name: p.name,
      priceMonthly: Number(p.priceMonthly),
      priceYearly: Number(p.priceYearly),
      maxOrgs: p.maxOrgs,
      maxSeats: p.maxSeats,
      features: p.features,
      active: p.active,
    })),
  });
});

const planSchema = z.object({
  name: z.string().min(1),
  priceMonthly: z.coerce.number().nonnegative(),
  priceYearly: z.coerce.number().nonnegative(),
  maxOrgs: z.coerce.number().int().positive(),
  maxSeats: z.coerce.number().int().positive(),
  features: z.record(z.string(), z.unknown()).optional().default({}),
  active: z.boolean().default(true),
});

platform.get("/plans/:code", async (c) => {
  const code = c.req.param("code");
  const [plan] = await db
    .select()
    .from(planCatalog)
    .where(eq(planCatalog.code, code))
    .limit(1);

  if (!plan) {
    throw new ApiError("PLAN_NOT_FOUND", "Plan not found", 404);
  }

  return c.json({
    plan: {
      code: plan.code,
      name: plan.name,
      priceMonthly: Number(plan.priceMonthly),
      priceYearly: Number(plan.priceYearly),
      maxOrgs: plan.maxOrgs,
      maxSeats: plan.maxSeats,
      features: plan.features,
      active: plan.active,
    },
  });
});

platform.put("/plans/:code", async (c) => {
  const code = c.req.param("code");
  const body = planSchema.parse(await c.req.json());

  const [plan] = await db
    .update(planCatalog)
    .set({
      name: body.name,
      priceMonthly: body.priceMonthly.toFixed(2),
      priceYearly: body.priceYearly.toFixed(2),
      maxOrgs: body.maxOrgs,
      maxSeats: body.maxSeats,
      features: body.features,
      active: body.active,
    })
    .where(eq(planCatalog.code, code))
    .returning();

  if (!plan) {
    throw new ApiError("PLAN_NOT_FOUND", "Plan not found", 404);
  }

  return c.json({ plan });
});

platform.post("/plans", async (c) => {
  const body = planSchema.extend({ code: z.string().min(1) }).parse(await c.req.json());

  const [plan] = await db
    .insert(planCatalog)
    .values({
      code: body.code,
      name: body.name,
      priceMonthly: body.priceMonthly.toFixed(2),
      priceYearly: body.priceYearly.toFixed(2),
      maxOrgs: body.maxOrgs,
      maxSeats: body.maxSeats,
      features: body.features,
      active: body.active,
    })
    .returning();

  return c.json({ plan }, 201);
});

const extendTrialSchema = z.object({
  days: z.number().int().positive().default(30),
});

platform.post("/users/:id/extend-trial", async (c) => {
  const userId = c.req.param("id");
  const body = extendTrialSchema.parse(await c.req.json());

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ApiError("USER_NOT_FOUND", "User not found", 404);

  const base = user.trialEndsAt && user.trialEndsAt > new Date() ? user.trialEndsAt : new Date();
  const trialEndsAt = new Date(base);
  trialEndsAt.setDate(trialEndsAt.getDate() + body.days);

  await db
    .update(users)
    .set({ trialEndsAt, subscriptionStatus: "trialing", plan: "trial" })
    .where(eq(users.id, userId));

  return c.json({ ok: true, trialEndsAt: trialEndsAt.toISOString() });
});

const setPlanSchema = z.object({
  planCode: z.string().min(1),
});

platform.post("/users/:id/set-plan", async (c) => {
  const userId = c.req.param("id");
  const body = setPlanSchema.parse(await c.req.json());

  const [plan] = await db
    .select()
    .from(planCatalog)
    .where(eq(planCatalog.code, body.planCode))
    .limit(1);

  if (!plan) throw new ApiError("PLAN_NOT_FOUND", "Plan not found", 404);

  await db
    .update(users)
    .set({ plan: body.planCode, subscriptionStatus: "active" })
    .where(eq(users.id, userId));

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (sub) {
    await db
      .update(subscriptions)
      .set({ planCode: body.planCode, status: "active", updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  } else {
    await db.insert(subscriptions).values({
      userId,
      planCode: body.planCode,
      status: "active",
    });
  }

  return c.json({ ok: true, planCode: body.planCode });
});

const createLicenseSchema = z.object({
  email: z.string().email().optional(),
  tier: z.string().min(1),
  seats: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

platform.post("/licenses", async (c) => {
  const body = createLicenseSchema.parse(await c.req.json());

  const [plan] = await db
    .select()
    .from(planCatalog)
    .where(eq(planCatalog.code, body.tier))
    .limit(1);

  if (!plan) throw new ApiError("PLAN_NOT_FOUND", "Plan tier not found", 404);

  const maxSeats = body.seats ?? plan.maxSeats;
  const key = generateLicenseKey({
    planCode: body.tier,
    maxOrgs: plan.maxOrgs,
    maxSeats,
    expiresAt: body.expiresAt,
  });

  const [record] = await db
    .insert(licenseKeys)
    .values({
      key,
      planCode: body.tier,
      maxOrgs: plan.maxOrgs,
      maxSeats,
      issuedTo: body.email,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    })
    .returning();

  return c.json(
    {
      license: {
        id: record!.id,
        key: record!.key,
        planCode: record!.planCode,
        maxOrgs: record!.maxOrgs,
        maxSeats: record!.maxSeats,
        issuedTo: record!.issuedTo,
        expiresAt: record!.expiresAt?.toISOString() ?? null,
      },
    },
    201,
  );
});

export default platform;
