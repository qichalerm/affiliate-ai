/**
 * `bun run winners:report` — print weekly winners/losers (also sent via Telegram).
 */

import { getWinnersAndLosers, formatWinnersLosersTelegram } from "../analytics/winners-losers.ts";
import { sendOperator } from "../lib/telegram.ts";
import { can } from "../lib/env.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const wl = await getWinnersAndLosers({ limit: 10 });
  const text = formatWinnersLosersTelegram(wl);
  console.log(text);

  if (can.alertTelegram() && process.argv[2] === "--send") {
    await sendOperator(text);
    console.log("\n✓ Sent to Telegram");
  }

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
