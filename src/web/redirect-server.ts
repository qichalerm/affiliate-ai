/**
 * Click-tracking redirect server (M8 — Sprint 1).
 *
 * Bun HTTP server that handles `GET /go/:shortId`:
 *   1. Look up the affiliate link by shortId
 *   2. Log the click (best-effort, non-blocking)
 *   3. 302-redirect to the affiliate destination URL
 *
 * Designed to run on the DigitalOcean Droplet alongside the scheduler.
 * In Sprint 4+ we may migrate this to a Cloudflare Pages Function for
 * edge latency, but starting on the Droplet keeps Postgres access simple
 * (no Hyperdrive needed).
 *
 * Run: `bun run src/web/redirect-server.ts`
 * Listens on REDIRECT_SERVER_PORT (default 3001).
 */

import { lookupAffiliateLink } from "../affiliate/link-generator.ts";
import { logClick } from "../affiliate/click-logger.ts";
import { closeDb } from "../lib/db.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("redirect-server");

const PORT = Number.parseInt(process.env.REDIRECT_SERVER_PORT ?? "3001", 10);
const HOST = process.env.REDIRECT_SERVER_HOST ?? "0.0.0.0";

/**
 * Optional shared secret. When set, every /go/ request must carry a matching
 * X-Internal-Auth header — set by the Cloudflare Pages Function that fronts
 * us. This keeps the public-facing droplet IP from being scraped directly.
 * If unset, all requests are accepted (useful for local development).
 */
const INTERNAL_AUTH_SECRET = process.env.INTERNAL_AUTH_SECRET ?? "";

function getClientIp(req: Request): string {
  // Reverse proxy will set these (nginx, Cloudflare, etc.)
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // Click redirect
    if (url.pathname.startsWith("/go/")) {
      // Auth check: when secret is configured, only the CF Pages Function
      // (which sends the matching header) can call us. Direct IP scrapes
      // get a 401 with no information leaked.
      if (INTERNAL_AUTH_SECRET) {
        const provided = req.headers.get("x-internal-auth");
        if (provided !== INTERNAL_AUTH_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      const shortId = url.pathname.slice(4).split("/")[0] ?? "";
      if (!shortId) {
        return new Response("Bad request: missing shortId", { status: 400 });
      }

      const link = await lookupAffiliateLink(shortId);
      if (!link) {
        log.info({ shortId }, "link not found / inactive / expired");
        return new Response("Link not found", { status: 404 });
      }

      // Log click in background — don't block the redirect on DB writes
      const clickInput = {
        affiliateLinkId: link.id,
        shortId,
        ip: getClientIp(req),
        userAgent: req.headers.get("user-agent") ?? "",
        countryCode: req.headers.get("cf-ipcountry"),
        referrer: req.headers.get("referer"),
      };
      void logClick(clickInput).catch((err) =>
        log.warn({ err: errMsg(err), shortId }, "background click log failed"),
      );

      return Response.redirect(link.fullUrl, 302);
    }

    // Default
    return new Response("Not found", { status: 404 });
  },
  error(err) {
    log.error({ err: errMsg(err) }, "server error");
    return new Response("Internal error", { status: 500 });
  },
});

log.info({ port: PORT, host: HOST }, `redirect server listening`);

async function shutdown(signal: string): Promise<void> {
  log.warn({ signal }, "shutdown signal received");
  server.stop();
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
