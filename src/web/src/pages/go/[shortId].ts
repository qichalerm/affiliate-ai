/**
 * Click redirect endpoint — captures clicks before bouncing to affiliate URL.
 *
 * NOTE: This endpoint requires SSR (Astro output: "server" or hybrid).
 * Static deployments (Cloudflare Pages default) won't run this.
 * For static deploys, rely on Short.io click tracking instead.
 *
 * Usage: <a href="/go/{shortId}"> instead of direct affiliate URL.
 *
 * Database side: writes to `clicks` table.
 */

import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import { sql } from "drizzle-orm";

// Tell Astro this is a server endpoint (requires hybrid mode in astro.config.mjs)
export const prerender = false;

export const GET: APIRoute = async ({ params, request, redirect }) => {
  const shortId = params.shortId;
  if (!shortId) return new Response("missing shortId", { status: 400 });

  // Look up affiliate link by sub_id (we use sub_id as our short identifier)
  const links = await db.execute<{ full_url: string; id: number }>(sql`
    SELECT id, full_url
      FROM affiliate_links
     WHERE sub_id = ${shortId}
     LIMIT 1
  `);
  const link = links[0];
  if (!link) return new Response("link not found", { status: 404 });

  // Capture click (best-effort, non-blocking)
  try {
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
    const ua = request.headers.get("user-agent") ?? "";
    const ref = request.headers.get("referer") ?? null;
    const country = request.headers.get("cf-ipcountry") ?? null;

    // Hash IP and UA (don't store raw)
    const ipHash = await sha256(ip);
    const uaHash = await sha256(ua);

    await db.execute(sql`
      INSERT INTO clicks (affiliate_link_id, ip_hash, country_code, user_agent_hash, referrer, is_unique)
      VALUES (${link.id}, ${ipHash}, ${country}, ${uaHash}, ${ref}, true)
    `);
  } catch (err) {
    console.warn("click log failed:", err);
  }

  return redirect(link.full_url, 302);
};

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
