/**
 * Postgres + Drizzle ORM connection.
 * Single shared pool — call closeDb() in scripts/oneshots.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { env } from "./env.ts";
import * as schemaImport from "../db/schema.ts";
import { child } from "./logger.ts";

const log = child("db");

// Re-export schema namespace for convenience
export const schema = schemaImport;

const client = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_SIZE,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {}, // silence NOTICE logs
});

export const db = drizzle(client, { schema });

/** Health check — returns true if DB responds. */
export async function pingDb(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    log.error({ err }, "DB ping failed");
    return false;
  }
}

/** Close the pool — call in CLI scripts before exit. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
