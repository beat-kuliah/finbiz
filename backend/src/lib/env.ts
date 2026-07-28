import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Unix socket dir for local Postgres when TCP is disabled (e.g. /home/.../pgsql/run) */
  PGHOST: z.string().optional(),
  PGDATABASE: z.string().optional(),
  PGUSER: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  JWT_SECRET: z.string().min(8),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  DEPLOYMENT_MODE: z.enum(["cloud", "selfhost"]).default("cloud"),
  MIDTRANS_SERVER_KEY: z.string().default(""),
  MIDTRANS_CLIENT_KEY: z.string().default(""),
  MIDTRANS_IS_PRODUCTION: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SELFHOST_LICENSE_SECRET: z.string().default("change-me"),
  SELFHOST_UNLOCK: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  PLATFORM_ADMIN_EMAIL: z.string().email(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(1),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default("FinBiz <noreply@finbiz.local>"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export const env = loadEnv();
