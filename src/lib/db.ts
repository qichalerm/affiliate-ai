import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema.ts";
import { env } from "./env.ts";
import { child } from "./logger.ts";

const log = child("db");

const queryClient = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_SIZE,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,
  onnotice: (notice) => log.debug({ notice }, "pg notice"),
});

export const db = drizzle(queryClient, { schema, logger: env.DEBUG_VERBOSE_LOGGING });

export { schema };

export async function pingDb(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    return true;
  } catch (err) {
    log.error({ err }, "DB ping failed");
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
