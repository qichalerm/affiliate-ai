/**
 * `bun run telegram:test` — send a test message to operator chat.
 */

import { sendOperator, pingBot } from "../lib/telegram.ts";
import { can } from "../lib/env.ts";

async function main() {
  if (!can.alertTelegram()) {
    console.error("❌ TELEGRAM_BOT_TOKEN or TELEGRAM_OPERATOR_CHAT_ID missing");
    process.exit(1);
  }

  const me = await pingBot();
  if (!me.ok) {
    console.error(`❌ Bot ping failed: ${me.error}`);
    process.exit(1);
  }
  console.log(`✓ Bot @${me.me} reachable`);

  await sendOperator(
    [
      "✅ *Connection Test*",
      "",
      "ระบบ Shopee Affiliate Bot ส่งข้อความเข้าถึงคุณได้แล้ว",
      "",
      "_ทดสอบโดย bun run telegram:test_",
    ].join("\n"),
  );
  console.log("✓ Test message sent. Check your Telegram.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
