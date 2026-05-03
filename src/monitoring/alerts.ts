/**
 * Alert helpers — write to alerts table + push to email (operator notification).
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { sendAlertEmail } from "../lib/email.ts";
import { child } from "../lib/logger.ts";

const log = child("alerts");

export type AlertSeverity = "info" | "warn" | "error" | "critical";

export interface CreateAlertInput {
  severity: AlertSeverity;
  code: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  requiresUserAction?: boolean;
  /** Suppress operator notification (for noisy events). */
  silent?: boolean;
}

export async function createAlert(input: CreateAlertInput): Promise<number> {
  const [row] = await db
    .insert(schema.alerts)
    .values({
      severity: input.severity,
      code: input.code,
      title: input.title,
      body: input.body,
      metadata: input.metadata,
      requiresUserAction: input.requiresUserAction ?? false,
    })
    .returning({ id: schema.alerts.id });

  log.info({ id: row.id, code: input.code, severity: input.severity }, input.title);

  // Email operator for warn+ unless silenced
  if (!input.silent && input.severity !== "info") {
    try {
      await sendAlertEmail({
        severity: input.severity === "critical" ? "critical" : input.severity === "error" ? "error" : "warn",
        title: input.title,
        body: input.body ?? "(no details)",
        metadata: input.metadata,
      });
      await db
        .update(schema.alerts)
        .set({ deliveredAt: new Date() })
        .where(eq(schema.alerts.id, row.id));
    } catch (err) {
      log.warn({ err }, "failed to deliver alert via email");
    }
  }

  return row.id;
}

export async function resolveAlert(id: number): Promise<void> {
  await db
    .update(schema.alerts)
    .set({ resolvedAt: new Date() })
    .where(eq(schema.alerts.id, id));
}
