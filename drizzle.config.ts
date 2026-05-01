import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder",
  },
  verbose: true,
  strict: true,
  // Idempotent migrations: prefer drizzle-kit migrate over push for production
  // For dev, db:push is still fine
  migrations: {
    table: "drizzle_migrations",
    schema: "public",
  },
});
