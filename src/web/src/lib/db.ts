/**
 * Read-only database client for the web build process.
 * Used by `getStaticPaths` in Astro to materialize pages from DB.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString =
  import.meta.env.DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost/placeholder";

const client = postgres(connectionString, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(client);
export { client };
