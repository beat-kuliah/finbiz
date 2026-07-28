import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./index.js";
import { appSettings, planCatalog, users } from "./schema.js";
import { env } from "../lib/env.js";

async function seed() {
  console.log("Seeding app settings...");
  await db
    .insert(appSettings)
    .values({ key: "trial_days", value: 90 })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: 90 },
    });

  console.log("Seeding plan catalog...");
  const plans = [
    {
      code: "trial",
      name: "Trial",
      priceMonthly: "0",
      priceYearly: "0",
      maxOrgs: 1,
      maxSeats: 2,
      features: { reports: true, multiOrg: false },
      active: true,
    },
    {
      code: "starter",
      name: "Starter",
      priceMonthly: "99000",
      priceYearly: "990000",
      maxOrgs: 1,
      maxSeats: 3,
      features: { reports: true, multiOrg: false, exports: true },
      active: true,
    },
    {
      code: "pro",
      name: "Pro",
      priceMonthly: "199000",
      priceYearly: "1990000",
      maxOrgs: 3,
      maxSeats: 10,
      features: { reports: true, multiOrg: true, exports: true, fixedAssets: true },
      active: true,
    },
    {
      code: "business",
      name: "Business",
      priceMonthly: "499000",
      priceYearly: "4990000",
      maxOrgs: 10,
      maxSeats: 50,
      features: {
        reports: true,
        multiOrg: true,
        exports: true,
        fixedAssets: true,
        apiAccess: true,
      },
      active: true,
    },
  ];

  for (const plan of plans) {
    await db.insert(planCatalog).values(plan).onConflictDoUpdate({
      target: planCatalog.code,
      set: {
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        maxOrgs: plan.maxOrgs,
        maxSeats: plan.maxSeats,
        features: plan.features,
        active: plan.active,
      },
    });
  }

  console.log("Seeding platform admin...");
  const passwordHash = await bcrypt.hash(env.PLATFORM_ADMIN_PASSWORD, 12);
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 365);

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, env.PLATFORM_ADMIN_EMAIL))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(users).values({
      email: env.PLATFORM_ADMIN_EMAIL,
      name: "Platform Admin",
      passwordHash,
      plan: "business",
      subscriptionStatus: "active",
      trialEndsAt,
      isPlatformAdmin: true,
    });
  } else {
    await db
      .update(users)
      .set({
        passwordHash,
        isPlatformAdmin: true,
        plan: "business",
        subscriptionStatus: "active",
      })
      .where(eq(users.email, env.PLATFORM_ADMIN_EMAIL));
  }

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
