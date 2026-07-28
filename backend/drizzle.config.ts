import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const socketHost = process.env.PGHOST;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: socketHost?.startsWith("/")
    ? {
        host: socketHost,
        port: 5432,
        user: process.env.PGUSER ?? "postgres",
        password: process.env.PGPASSWORD ?? "Admin123",
        database: process.env.PGDATABASE ?? "finbiz",
      }
    : {
        url: process.env.DATABASE_URL!,
      },
});
