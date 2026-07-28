import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { appSettings, memberships, organizations, planCatalog, users } from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";

export type EntitlementAction =
  | "create_org"
  | "invite_member"
  | "post_journal"
  | "export_report"
  | "manage_fixed_assets";

export async function getUserPlanLimits(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new ApiError("USER_NOT_FOUND", "User not found", 404);
  }

  const [plan] = await db
    .select()
    .from(planCatalog)
    .where(eq(planCatalog.code, user.plan))
    .limit(1);

  if (!plan) {
    throw new ApiError("PLAN_NOT_FOUND", "Plan not found", 500);
  }

  const [trialSetting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "trial_days"))
    .limit(1);

  const trialDays =
    typeof trialSetting?.value === "number" ? trialSetting.value : 90;

  const isTrialActive =
    user.plan === "trial" &&
    user.trialEndsAt !== null &&
    user.trialEndsAt > new Date();

  const isSubscriptionActive =
    user.subscriptionStatus === "active" || isTrialActive;

  return {
    user,
    plan,
    trialDays,
    isTrialActive,
    isSubscriptionActive,
  };
}

export async function assertEntitled(
  userId: string,
  action: EntitlementAction,
): Promise<void> {
  const { plan, isSubscriptionActive } = await getUserPlanLimits(userId);

  if (!isSubscriptionActive) {
    throw new ApiError(
      "SUBSCRIPTION_INACTIVE",
      "Subscription or trial has expired",
      403,
    );
  }

  const features = plan.features as Record<string, boolean>;

  switch (action) {
    case "create_org":
      if (userId && plan.maxOrgs <= 0) {
        throw new ApiError("NOT_ENTITLED", "Plan does not allow organizations", 403);
      }
      break;
    case "invite_member":
      break;
    case "post_journal":
      break;
    case "export_report":
      if (!features.exports) {
        throw new ApiError("NOT_ENTITLED", "Plan does not include exports", 403);
      }
      break;
    case "manage_fixed_assets":
      if (!features.fixedAssets) {
        throw new ApiError(
          "NOT_ENTITLED",
          "Plan does not include fixed assets",
          403,
        );
      }
      break;
    default:
      throw new ApiError("NOT_ENTITLED", "Unknown entitlement action", 403);
  }
}

export async function assertWithinLimit(
  userId: string,
  limit: "max_orgs" | "max_seats",
  orgId?: string,
): Promise<void> {
  const { plan } = await getUserPlanLimits(userId);

  if (limit === "max_orgs") {
    const owned = await db
      .select({ id: organizations.id })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.orgId, organizations.id))
      .where(
        and(eq(memberships.userId, userId), eq(memberships.role, "owner")),
      );

    const ownerCount = owned.length;
    if (ownerCount >= plan.maxOrgs) {
      throw new ApiError(
        "LIMIT_EXCEEDED",
        `Maximum organizations (${plan.maxOrgs}) reached`,
        403,
      );
    }
    return;
  }

  if (limit === "max_seats" && orgId) {
    const members = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.orgId, orgId));

    if (members.length >= plan.maxSeats) {
      throw new ApiError(
        "LIMIT_EXCEEDED",
        `Maximum seats (${plan.maxSeats}) reached for this organization`,
        403,
      );
    }
  }
}

export async function assertWritable(userId: string, orgId: string): Promise<void> {
  const { isSubscriptionActive } = await getUserPlanLimits(userId);

  if (!isSubscriptionActive) {
    throw new ApiError(
      "SUBSCRIPTION_INACTIVE",
      "Subscription or trial has expired — read-only mode",
      403,
    );
  }

  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);

  if (!membership) {
    throw new ApiError("FORBIDDEN", "Not a member of this organization", 403);
  }

  if (membership.role === "viewer") {
    throw new ApiError("FORBIDDEN", "Viewers cannot modify data", 403);
  }
}
