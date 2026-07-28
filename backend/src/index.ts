import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { env } from "./lib/env.js";
import { errorResponse, isApiError } from "./lib/errors.js";
import { connectRedis } from "./lib/redis.js";
import { startTrialReminderJob } from "./modules/mail/trialJob.js";
import authRoutes from "./routes/auth.js";
import orgRoutes from "./routes/orgs.js";
import accountsRoutes from "./routes/accounts.js";
import arapRoutes from "./routes/arap.js";
import assetsRoutes from "./routes/assets.js";
import contactsRoutes from "./routes/contacts.js";
import dashboardRoutes from "./routes/dashboard.js";
import documentsRoutes from "./routes/documents.js";
import journalsRoutes from "./routes/journals.js";
import reportsRoutes from "./routes/reports.js";
import periodsRoutes from "./routes/periods.js";
import { billing, license } from "./routes/billing.js";
import auditLogsRoutes from "./routes/audit-logs.js";
import platformAuthRoutes from "./routes/platform/auth.js";
import platformRoutes from "./routes/platform/index.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Organization-Id"],
  }),
);

app.onError((err, c) => {
  if (isApiError(err)) {
    return c.json(errorResponse(err.code, err.message), err.status as 400);
  }

  if (err instanceof ZodError) {
    const message = err.issues[0]?.message ?? "Validation failed";
    return c.json(errorResponse("VALIDATION_ERROR", message), 400);
  }

  console.error("Unhandled error:", err);
  return c.json(errorResponse("INTERNAL_ERROR", "Internal server error"), 500);
});

app.notFound((c) =>
  c.json(errorResponse("NOT_FOUND", "Route not found"), 404),
);

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/orgs", orgRoutes);
app.route("/api/accounts", accountsRoutes);
app.route("/api/contacts", contactsRoutes);
app.route("/api/documents", documentsRoutes);
app.route("/api/journals", journalsRoutes);
app.route("/api/assets", assetsRoutes);
app.route("/api", arapRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/reports", reportsRoutes);
app.route("/api/periods", periodsRoutes);
app.route("/api/billing", billing);
app.route("/api/license", license);
app.route("/api/audit-logs", auditLogsRoutes);
app.route("/api/platform/auth", platformAuthRoutes);
app.route("/api/platform", platformRoutes);

async function main() {
  await connectRedis();
  startTrialReminderJob();
  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      console.log(`FinBiz API listening on http://localhost:${info.port}`);
    },
  );
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

export default app;
