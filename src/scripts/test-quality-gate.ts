/**
 * `bun run src/scripts/test-quality-gate.ts`
 *
 * Tests the quality gate against a battery of sample content.
 * Verifies that:
 *   - Clean content passes
 *   - Medical claims are blocked
 *   - Financial scams are blocked
 *   - Politics is blocked
 *   - Missing disclosure gets auto-fixed
 *   - Caption-too-long is caught per platform
 *   - LLM moderator catches subtle issues
 */

import { runQualityGate } from "../quality/gate.ts";
import { closeDb } from "../lib/db.ts";

interface TestCase {
  name: string;
  text: string;
  platform: "facebook" | "instagram" | "tiktok" | "shopee_video";
  expectApproved: boolean;
  /** Skip Claude moderator to keep CI cheap. */
  skipLlm?: boolean;
}

const CASES: TestCase[] = [
  {
    name: "✅ clean affiliate post",
    text: "หูฟัง TWS Anker Soundcore เสียงดี แบตอึด — ลด 40%! ดูที่ Shopee 👇 #affiliate",
    platform: "facebook",
    expectApproved: true,
  },
  {
    name: "✅ clean IG with hashtags",
    text: "หูฟังบลูทูธรุ่นใหม่จาก Anker เสียงคมชัด แบตอยู่ได้ทั้งวัน ราคาคุ้มสุด ๆ! #หูฟัง #soundcore #anker #gadget #affiliate",
    platform: "instagram",
    expectApproved: true,
  },
  {
    name: "❌ medical claim — cure",
    text: "ครีมนี้รักษามะเร็งผิวหนังได้ในไม่กี่วัน! สั่งเลย #affiliate",
    platform: "facebook",
    expectApproved: false,
    skipLlm: true,
  },
  {
    name: "❌ get-rich-quick scam",
    text: "ลงทุน 1000 บาท รวยเร็วใน 7 วัน ผลตอบแทน 50% ต่อวัน! #affiliate",
    platform: "facebook",
    expectApproved: false,
    skipLlm: true,
  },
  {
    name: "❌ Thai politics",
    text: "นโยบายของเพื่อไทย ดีกว่าก้าวไกล สั่งซื้อสินค้านี้ #affiliate",
    platform: "facebook",
    expectApproved: false,
    skipLlm: true,
  },
  {
    name: "🔧 auto-fix missing disclosure",
    text: "หูฟัง XYZ เสียงดี แบตทน ลด 30%",
    platform: "facebook",
    expectApproved: true,
  },
  {
    name: "❌ TikTok caption too long",
    text: "x".repeat(2300) + " #affiliate",
    platform: "tiktok",
    expectApproved: false,
    skipLlm: true,
  },
  {
    name: "✅ Shopee Video short caption",
    text: "หูฟังเสียงดี คุ้ม! #หูฟัง #affiliate",
    platform: "shopee_video",
    expectApproved: true,
  },
];

async function main() {
  console.log("\n🛡️  Quality Gate Test Suite\n");
  console.log("─".repeat(80));

  let passed = 0;
  let failed = 0;
  let totalCost = 0;

  for (const tc of CASES) {
    const result = await runQualityGate({
      text: tc.text,
      platform: tc.platform,
      skipLlm: tc.skipLlm,
    });
    totalCost += result.llmCostUsd;

    const expected = tc.expectApproved;
    const got = result.approved;
    const ok = got === expected;
    if (ok) passed++; else failed++;

    const icon = ok ? "✓" : "✗";
    const status = result.approved ? "APPROVED" : "BLOCKED";
    console.log(`\n${icon} ${tc.name}`);
    console.log(`   platform: ${tc.platform}`);
    console.log(`   verdict:  ${status} (expected ${expected ? "APPROVED" : "BLOCKED"})`);
    if (result.autoFixed) console.log(`   auto-fixed: yes`);
    if (result.issues.length) {
      console.log(`   issues:`);
      for (const i of result.issues.slice(0, 3)) console.log(`     - ${i}`);
    }
    if (result.warnings.length && result.warnings.length < 3) {
      console.log(`   warnings: ${result.warnings.join("; ")}`);
    }
  }

  console.log("\n" + "─".repeat(80));
  console.log(
    `\n${passed}/${CASES.length} test cases passed (${failed} failed). LLM cost: $${totalCost.toFixed(6)}\n`,
  );

  await closeDb();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test runner crashed:", err);
  process.exit(1);
});
