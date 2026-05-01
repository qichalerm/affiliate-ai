/**
 * Resend email client — backup notification channel.
 *
 * Use cases:
 *   - Critical alerts when Telegram is down
 *   - Daily reports for stakeholders (bcc)
 *   - Invoice/billing alerts
 *
 * Quota: Resend free 3,000 emails/month — way more than we need.
 */

import { Resend } from "resend";
import { env } from "./env.ts";
import { child } from "./logger.ts";
import { errMsg, retry } from "./retry.ts";

const log = child("email");

let _client: Resend | undefined;

function client(): Resend {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  if (!_client) _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  /** Add tags for analytics filtering. */
  tags?: Array<{ name: string; value: string }>;
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ id?: string; error?: string }> {
  if (!env.RESEND_API_KEY) {
    log.debug({ subject: opts.subject }, "RESEND_API_KEY not set; skip");
    return { error: "no-api-key" };
  }
  if (env.DEBUG_DRY_RUN) {
    log.info({ subject: opts.subject, to: opts.to }, "[dry-run] would send email");
    return { id: "dry-run" };
  }

  try {
    const result = await retry(
      async () =>
        client().emails.send({
          from: opts.from ?? env.EMAIL_FROM ?? "alerts@example.com",
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
          reply_to: opts.replyTo,
          tags: opts.tags,
        } as Parameters<Resend["emails"]["send"]>[0]),
      { attempts: 2, baseDelayMs: 500 },
    );
    if ("data" in result && result.data) {
      return { id: result.data.id };
    }
    return { error: "unknown-response" };
  } catch (err) {
    log.warn({ err: errMsg(err), subject: opts.subject }, "email send failed");
    return { error: errMsg(err) };
  }
}

/**
 * Send an alert email (operator).
 * Used as backup when Telegram fails or for critical events.
 */
export async function sendAlertEmail(input: {
  severity: "warn" | "error" | "critical";
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  if (!env.OPERATOR_EMAIL) {
    log.debug("OPERATOR_EMAIL not set; skip alert email");
    return false;
  }

  const icon = input.severity === "critical" ? "🚨" : input.severity === "error" ? "❌" : "⚠️";

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
      <h2>${icon} ${escapeHtml(input.title)}</h2>
      <pre style="white-space: pre-wrap; background: #f5f5f5; padding: 12px; border-radius: 4px;">${escapeHtml(input.body)}</pre>
      ${
        input.metadata
          ? `<details>
              <summary>Metadata</summary>
              <pre>${escapeHtml(JSON.stringify(input.metadata, null, 2))}</pre>
            </details>`
          : ""
      }
      <p style="color: #888; font-size: 12px;">
        Affiliate Bot · ${new Date().toISOString()}
      </p>
    </div>
  `;

  const result = await sendEmail({
    to: env.OPERATOR_EMAIL,
    subject: `${icon} ${input.title}`,
    html,
    text: `${input.title}\n\n${input.body}`,
    tags: [
      { name: "severity", value: input.severity },
      { name: "type", value: "alert" },
    ],
  });

  return Boolean(result.id);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
