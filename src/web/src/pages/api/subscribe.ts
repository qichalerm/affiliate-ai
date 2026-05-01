/**
 * POST /api/subscribe
 *
 * Body: { email: string, niche?: string, source?: string }
 * Adds subscriber, sends confirmation email (double opt-in).
 *
 * Returns: { ok: true } | { ok: false, error: string }
 */

import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import { sql } from "drizzle-orm";

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  let body: { email?: string; niche?: string; source?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }

  // Reject obvious bot/spam patterns
  if (
    email.length > 250 ||
    email.includes("..") ||
    /^[a-z]+\d{5,}@/.test(email) // pattern like "abcdef12345@..."
  ) {
    return json({ ok: false, error: "rejected" }, 400);
  }

  // Generate confirmation token
  const token = crypto.randomUUID().replace(/-/g, "");
  const niche = body.niche?.slice(0, 32) ?? null;
  const source = body.source?.slice(0, 64) ?? "form";

  try {
    // Upsert subscriber
    await db.execute(sql`
      INSERT INTO email_subscribers (email, niche, source, confirmation_token, consented_at)
      VALUES (${email}, ${niche}, ${source}, ${token}, now())
      ON CONFLICT (email) DO UPDATE
        SET niche = COALESCE(EXCLUDED.niche, email_subscribers.niche),
            source = COALESCE(EXCLUDED.source, email_subscribers.source),
            unsubscribed_at = NULL
    `);

    // Send confirmation email
    const domain = import.meta.env.DOMAIN_NAME ?? process.env.DOMAIN_NAME ?? "yourdomain.com";
    const confirmUrl = `https://${domain}/confirm/${token}`;
    await sendConfirmationEmail(email, confirmUrl);

    return json({ ok: true });
  } catch (err) {
    console.error("subscribe failed:", err);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

async function sendConfirmationEmail(email: string, confirmUrl: string): Promise<void> {
  const apiKey = import.meta.env.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — confirmation skipped");
    return;
  }
  const fromEmail =
    import.meta.env.EMAIL_FROM ??
    process.env.EMAIL_FROM ??
    "noreply@example.com";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: email,
      subject: "ยืนยันการสมัครรับดีลรายสัปดาห์",
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:500px">
          <h2>ขอบคุณที่สมัคร DealFinder</h2>
          <p>กดปุ่มด้านล่างเพื่อยืนยันอีเมลของคุณ จากนั้นคุณจะได้รับดีลคัดสรรประจำสัปดาห์</p>
          <p>
            <a href="${confirmUrl}" style="display:inline-block;background:#ea580c;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
              ยืนยันอีเมล
            </a>
          </p>
          <p style="color:#94a3b8;font-size:12px;">
            หรือ copy ลิงก์นี้ไปวางในเบราว์เซอร์: ${confirmUrl}<br>
            ถ้าไม่ได้สมัคร เพิกเฉยอีเมลนี้ได้เลย
          </p>
        </div>
      `,
      text: `ขอบคุณที่สมัคร DealFinder\n\nยืนยันอีเมล: ${confirmUrl}`,
    }),
  });
}

function json(obj: object, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
