/**
 * Alert helpers — write to alerts table + push to Telegram.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { sendOperator } from "../lib/telegram.ts";
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
  silentTelegram?: boolean;
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

  // Notify operator (Telegram) for warn+ unless silenced
  if (!input.silentTelegram && input.severity !== "info") {
    const icon = input.severity === "critical" ? "🚨" : input.severity === "error" ? "❌" : "⚠️";
    const lines = [`${icon} *${input.title}*`];
    if (input.body) lines.push("", input.body);
    if (input.requiresUserAction) lines.push("", "_ต้องการการตัดสินใจของคุณ_");
    try {
      await sendOperator(lines.join("\n"));
      await db
        .update(schema.alerts)
        .set({ deliveredAt: new Date() })
        .where(eq(schema.alerts.id, row.id));
    } catch (err) {
      log.warn({ err }, "failed to deliver alert via telegram");
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
