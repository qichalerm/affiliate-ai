import type { APIRoute } from "astro";

const SITE = process.env.SITE_URL ?? `https://${process.env.DOMAIN_NAME ?? "yourdomain.com"}`;

export const GET: APIRoute = () => {
  const body = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/

Sitemap: ${SITE}/sitemap-index.xml
`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
};
