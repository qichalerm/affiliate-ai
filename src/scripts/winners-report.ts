/**
 * `bun run winners:report` — print weekly winners/losers to stdout.
 */

import { getWinnersAndLosers, formatWinnersLosers } from "../analytics/winners-losers.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const wl = await getWinnersAndLosers({ limit: 10 });
  const text = formatWinnersLosers(wl);
  console.log(text);

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
