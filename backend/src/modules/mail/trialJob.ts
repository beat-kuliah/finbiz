import { and, eq, lte, gte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { sendTrialReminder } from "./index.js";

const REMINDER_DAYS = [7, 3, 1];

export async function checkTrialsAndNotify(): Promise<{ notified: number }> {
  const now = new Date();
  let notified = 0;

  for (const daysLeft of REMINDER_DAYS) {
    const target = new Date(now);
    target.setDate(target.getDate() + daysLeft);
    const dayStart = new Date(target);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(target);
    dayEnd.setHours(23, 59, 59, 999);

    const trialUsers = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.plan, "trial"),
          gte(users.trialEndsAt, dayStart),
          lte(users.trialEndsAt, dayEnd),
        ),
      );

    for (const user of trialUsers) {
      try {
        await sendTrialReminder(user.email, user.name, daysLeft);
        notified += 1;
      } catch (err) {
        console.error(`Failed to send trial reminder to ${user.email}:`, err);
      }
    }
  }

  return { notified };
}

export function startTrialReminderJob(intervalMs = 12 * 60 * 60 * 1000): void {
  const run = () => {
    checkTrialsAndNotify().catch((err) => {
      console.error("Trial reminder job failed:", err);
    });
  };
  run();
  setInterval(run, intervalMs);
}
