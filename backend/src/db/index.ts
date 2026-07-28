import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../lib/env.js";
import * as schema from "./schema.js";

function createClient() {
  if (env.PGHOST?.startsWith("/")) {
    return postgres({
      host: env.PGHOST,
      database: env.PGDATABASE ?? "finbiz",
      username: env.PGUSER ?? "postgres",
      password: env.PGPASSWORD ?? "Admin123",
      max: 10,
    });
  }
  return postgres(env.DATABASE_URL, { max: 10 });
}

const client = createClient();

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
