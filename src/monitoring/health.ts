/**
 * System health checks — run periodically by scheduler.
 * Each check returns {ok, detail}. Failures emit alerts via createAlert.
 */

import { pingDb } from "../lib/db.ts";
import { can, env } from "../lib/env.ts";
import { createAlert } from "./alerts.ts";
import { child } from "../lib/logger.ts";

const log = child("health");

export interface HealthResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  timestamp: Date;
}

export async function runHealthChecks(): Promise<HealthResult> {
  const checks: HealthResult["checks"] = [];
  const timestamp = new Date();

  // DB ping
  try {
    const dbOk = await pingDb();
    checks.push({ name: "db.ping", ok: dbOk });
    if (!dbOk) {
      await createAlert({
        severity: "critical",
        code: "db.unreachable",
        title: "Database unreachable",
        body: "Cannot ping Postgres. Check DATABASE_URL and Neon dashboard.",
      });
    }
  } catch (err) {
    checks.push({ name: "db.ping", ok: false, detail: String(err) });
  }

  // Anthropic credit (basic — actual quota check requires admin API)
  checks.push({ name: "claude.configured", ok: can.generateContent() });

  // Feature flag self-consistency
  const featureProblems: string[] = [];
  if (env.FEATURE_TIKTOK_AUTO_POST && !can.postTikTok()) {
    featureProblems.push("TIKTOK_AUTO_POST enabled but TIKTOK_ACCESS_TOKEN missing");
  }
  if (env.FEATURE_META_AUTO_POST && !can.postMeta()) {
    featureProblems.push("META_AUTO_POST enabled but META_PAGE_ACCESS_TOKEN missing");
  }
  if (env.FEATURE_PINTEREST_AUTO_POST && !can.postPinterest()) {
    featureProblems.push("PINTEREST_AUTO_POST enabled but token missing");
  }
  checks.push({
    name: "feature_flags.consistent",
    ok: featureProblems.length === 0,
    detail: featureProblems.join("; ") || undefined,
  });
  if (featureProblems.length > 0) {
    await createAlert({
      severity: "warn",
      code: "feature.misconfigured",
      title: "Feature flags inconsistent",
      body: featureProblems.join("\n"),
    });
  }

  const ok = checks.every((c) => c.ok);
  log.info({ ok, count: checks.length }, "health check done");
  return { ok, checks, timestamp };
}
