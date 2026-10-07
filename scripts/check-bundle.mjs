// The app's first-load JavaScript, held under a budget: a heavy library
// imported eagerly (a syntax highlighter's every grammar, a diagram renderer)
// fails here instead of shipping to the phone. Run after `next build`.
import { readFileSync } from "fs";

// Bytes, uncompressed. 1.04 MB when this was set (2026-10-07), down from 2.07.
const BUDGETS = { "/": 1_200_000 };

const stats = JSON.parse(
  readFileSync(".next/diagnostics/route-bundle-stats.json", "utf-8")
);
let failed = false;
for (const [route, budget] of Object.entries(BUDGETS)) {
  const entry = stats.find((r) => r.route === route);
  if (!entry) {
    console.error(`bundle: no stats for ${route}; did the build run?`);
    failed = true;
    continue;
  }
  const bytes = entry.firstLoadUncompressedJsBytes;
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  if (bytes > budget) {
    console.error(
      `bundle: ${route} loads ${kb(bytes)} of JS first, over its ${kb(budget)} budget.\n` +
        "  Load the heavy part with next/dynamic or import(); see what's in it with\n" +
        "  `npx next experimental-analyze`."
    );
    failed = true;
  } else {
    console.log(`bundle: ${route} ${kb(bytes)} of ${kb(budget)}`);
  }
}
process.exit(failed ? 1 : 0);
