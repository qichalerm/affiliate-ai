/**
 * /go/<shortId> click-tracking redirect — Cloudflare Pages Function.
 *
 * Runs at Cloudflare's edge (Workers runtime). Proxies the request to
 * the redirect-server.ts process running on the droplet, which performs
 * the DB lookup, logs the click (with hashed IP/UA, country), and returns
 * a 302 Location header back to the user's browser.
 *
 * Why this proxy exists:
 *   - DB (postgres) lives on the droplet at localhost:5432, not reachable
 *     from Workers without Hyperdrive (and that needs Zone permissions
 *     this token doesn't have).
 *   - Pages Functions can fetch any HTTPS hostname → the droplet exposes
 *     port 3001 via Cloudflare Tunnel as https://api.<your-domain>,
 *     gated by the X-Internal-Auth shared secret so direct hits to the
 *     tunnel hostname get 401 with no info leaked.
 *
 * NOTE: outbound fetch from Workers/Pages CANNOT use bare IP + HTTP —
 * Cloudflare returns error 1003 on the function side. We tried that
 * path first; it doesn't work. The tunnel hostname is required.
 *
 * Env (set via Pages project env vars):
 *   INTERNAL_AUTH_SECRET — must match droplet's redirect-server.ts
 *   ORIGIN_URL           — https://api.<your-domain> (CF Tunnel hostname)
 */

interface Env {
  INTERNAL_AUTH_SECRET: string;
  ORIGIN_URL: string;
}

// Handle both GET and HEAD — link preview bots (Slack, FB, Discord, X)
// often HEAD a URL before unfurling. Without onRequestHead, those hits
// fall through to CF Pages' default static handler and return 200/HTML
// instead of the proper 302, breaking unfurl + confusing crawlers.
export const onRequestHead: PagesFunction<Env> = (ctx) => onRequestGet(ctx);

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env }) => {
  const shortId = String(params.shortId ?? "").trim();
  if (!shortId) {
    return new Response("Bad request", { status: 400 });
  }

  if (!env.ORIGIN_URL || !env.INTERNAL_AUTH_SECRET) {
    return new Response("Service misconfigured", { status: 500 });
  }

  const upstream = new URL(`/go/${encodeURIComponent(shortId)}`, env.ORIGIN_URL);

  let response: Response;
  try {
    response = await fetch(upstream.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        "x-internal-auth": env.INTERNAL_AUTH_SECRET,
        "cf-connecting-ip": request.headers.get("cf-connecting-ip") ?? "",
        "cf-ipcountry": request.headers.get("cf-ipcountry") ?? "",
        "user-agent": request.headers.get("user-agent") ?? "",
        "referer": request.headers.get("referer") ?? "",
      },
    });
  } catch (err) {
    return new Response(`Origin unreachable: ${err instanceof Error ? err.message : String(err)}`, {
      status: 502,
    });
  }

  // Forward upstream response (preserves 302 + Location, 401 if auth out
  // of sync, 404 for unknown shortIds). Strip hop-by-hop headers.
  const out = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  out.headers.delete("connection");
  out.headers.delete("transfer-encoding");
  return out;
};
