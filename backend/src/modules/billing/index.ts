import { createHmac, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../../db/index.js";
import {
  billingEvents,
  memberships,
  organizations,
  planCatalog,
  subscriptions,
  users,
} from "../../db/schema.js";
import { env } from "../../lib/env.js";
import { ApiError } from "../../lib/errors.js";

export async function getActivePlans() {
  return db
    .select()
    .from(planCatalog)
    .where(eq(planCatalog.active, true));
}

export async function getUserSubscription(userId: string) {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ApiError("USER_NOT_FOUND", "User not found", 404);

  const [plan] = await db
    .select()
    .from(planCatalog)
    .where(eq(planCatalog.code, user.plan))
    .limit(1);

  return { user, subscription: sub ?? null, plan: plan ?? null };
}

export async function getUsage(userId: string) {
  const ownedOrgs = await db
    .select({ id: organizations.id })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));

  const userOrgRows = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.userId, userId));

  const orgIds = [...new Set(userOrgRows.map((r) => r.orgId))];
  let seatCount = 0;

  for (const orgId of orgIds) {
    const members = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.orgId, orgId));
    seatCount += members.length;
  }

  return {
    orgCount: ownedOrgs.length,
    seatCount,
  };
}

export interface CheckoutInput {
  userId: string;
  planCode: string;
  interval: "monthly" | "yearly";
}

export async function createCheckout(input: CheckoutInput) {
  const [plan] = await db
    .select()
    .from(planCatalog)
    .where(and(eq(planCatalog.code, input.planCode), eq(planCatalog.active, true)))
    .limit(1);

  if (!plan) {
    throw new ApiError("PLAN_NOT_FOUND", "Plan not found or inactive", 404);
  }

  const amount =
    input.interval === "yearly"
      ? Number(plan.priceYearly)
      : Number(plan.priceMonthly);

  const orderId = `FIN-${nanoid(12)}`;

  let [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, input.userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (!sub) {
    [sub] = await db
      .insert(subscriptions)
      .values({
        userId: input.userId,
        planCode: input.planCode,
        status: "trialing",
      })
      .returning();
  }

  await db.insert(billingEvents).values({
    userId: input.userId,
    subscriptionId: sub!.id,
    type: "subscription_created",
    amount: amount.toFixed(2),
    metadata: {
      orderId,
      planCode: input.planCode,
      interval: input.interval,
      status: "pending",
    },
  });

  const hasMidtrans = env.MIDTRANS_SERVER_KEY.length > 0 && env.MIDTRANS_CLIENT_KEY.length > 0;

  if (!hasMidtrans) {
    return {
      snapToken: "mock",
      redirectUrl: `https://app.finbiz.local/billing/checkout/mock?orderId=${orderId}`,
      orderId,
      mock: true,
    };
  }

  // TODO: integrate Midtrans Snap API when keys are configured
  return {
    snapToken: "mock",
    redirectUrl: `https://app.finbiz.local/billing/checkout/mock?orderId=${orderId}`,
    orderId,
    mock: true,
  };
}

export async function handleMidtransWebhook(payload: Record<string, unknown>) {
  const orderId = String(payload.order_id ?? payload.orderId ?? "");
  const status = String(payload.transaction_status ?? payload.status ?? "").toLowerCase();
  const fraudStatus = String(payload.fraud_status ?? "accept").toLowerCase();

  if (!orderId) {
    throw new ApiError("INVALID_WEBHOOK", "Missing order id", 400);
  }

  const success =
    status === "capture" ||
    status === "settlement" ||
    status === "success" ||
    (status === "accept" && fraudStatus === "accept");

  const events = await db
    .select()
    .from(billingEvents)
    .orderBy(desc(billingEvents.createdAt))
    .limit(100);

  const event = events.find(
    (e) => (e.metadata as Record<string, unknown>)?.orderId === orderId,
  );

  if (!event) {
    return { ok: true, matched: false };
  }

  if (success) {
    const meta = (event.metadata ?? {}) as Record<string, unknown>;
    const planCode = String(meta.planCode ?? "starter");

    await db
      .update(users)
      .set({
        plan: planCode,
        subscriptionStatus: "active",
      })
      .where(eq(users.id, event.userId));

    if (event.subscriptionId) {
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + (meta.interval === "yearly" ? 12 : 1));

      await db
        .update(subscriptions)
        .set({
          planCode,
          status: "active",
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, event.subscriptionId));
    }

    await db.insert(billingEvents).values({
      userId: event.userId,
      subscriptionId: event.subscriptionId,
      type: "payment_succeeded",
      amount: event.amount,
      metadata: { orderId, webhook: payload },
    });
  } else {
    await db.insert(billingEvents).values({
      userId: event.userId,
      subscriptionId: event.subscriptionId,
      type: "payment_failed",
      metadata: { orderId, webhook: payload },
    });
  }

  return { ok: true, matched: true, success };
}

export async function cancelSubscription(userId: string) {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (!sub) {
    throw new ApiError("SUBSCRIPTION_NOT_FOUND", "No subscription found", 404);
  }

  await db
    .update(subscriptions)
    .set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  await db
    .update(users)
    .set({ subscriptionStatus: "canceled" })
    .where(eq(users.id, userId));

  await db.insert(billingEvents).values({
    userId,
    subscriptionId: sub.id,
    type: "subscription_canceled",
  });

  return { ok: true };
}

export async function changePlan(userId: string, planCode: string) {
  const [plan] = await db
    .select()
    .from(planCatalog)
    .where(and(eq(planCatalog.code, planCode), eq(planCatalog.active, true)))
    .limit(1);

  if (!plan) {
    throw new ApiError("PLAN_NOT_FOUND", "Plan not found", 404);
  }

  await db.update(users).set({ plan: planCode }).where(eq(users.id, userId));

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (sub) {
    await db
      .update(subscriptions)
      .set({ planCode, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  }

  return { ok: true, planCode };
}

export async function listInvoices(userId: string) {
  const events = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.userId, userId))
    .orderBy(desc(billingEvents.createdAt))
    .limit(50);

  return events.map((e) => ({
    id: e.id,
    type: e.type,
    amount: e.amount ? Number(e.amount) : null,
    metadata: e.metadata,
    createdAt: e.createdAt.toISOString(),
  }));
}

export function generateLicenseKey(payload: {
  planCode: string;
  maxOrgs: number;
  maxSeats: number;
  expiresAt?: string;
}): string {
  const data = JSON.stringify({
    p: payload.planCode,
    o: payload.maxOrgs,
    s: payload.maxSeats,
    e: payload.expiresAt ?? null,
    n: randomBytes(4).toString("hex"),
  });
  const sig = createHmac("sha256", env.SELFHOST_LICENSE_SECRET)
    .update(data)
    .digest("hex")
    .slice(0, 16);
  const body = Buffer.from(data).toString("base64url");
  return `FBIZ-${body}.${sig}`;
}

export function verifyLicenseKey(key: string): {
  planCode: string;
  maxOrgs: number;
  maxSeats: number;
  expiresAt: string | null;
} | null {
  const match = /^FBIZ-([A-Za-z0-9_-]+)\.([a-f0-9]{16})$/.exec(key);
  if (!match) return null;

  const [, body, sig] = match;
  const data = Buffer.from(body!, "base64url").toString("utf8");
  const expected = createHmac("sha256", env.SELFHOST_LICENSE_SECRET)
    .update(data)
    .digest("hex")
    .slice(0, 16);

  if (sig !== expected) return null;

  try {
    const parsed = JSON.parse(data) as {
      p: string;
      o: number;
      s: number;
      e: string | null;
    };
    return {
      planCode: parsed.p,
      maxOrgs: parsed.o,
      maxSeats: parsed.s,
      expiresAt: parsed.e,
    };
  } catch {
    return null;
  }
}

export function isLicenseFeatureEnabled(): boolean {
  return env.DEPLOYMENT_MODE === "selfhost" || env.SELFHOST_UNLOCK;
}
