// The app's first-load JavaScript, watched against a budget. Going over it
// warns rather than fails: growth is sometimes worth it, and the point is to
// notice a big jump (a syntax highlighter's every grammar, a diagram renderer
// imported eagerly) before it ships to the phone. On CI the warning becomes an
// annotation on the PR. A missing or unreadable size still fails, so a broken
// check can't pass quietly. Run after `next build`.
import { appendFileSync, readFileSync } from "fs";

// Bytes, uncompressed. 1.04 MB when this was set (2026-10-07), down from 2.07.
const BUDGETS = { "/": 1_200_000 };

const statsPath =
  process.argv[2] ?? ".next/diagnostics/route-bundle-stats.json";
const stats = JSON.parse(readFileSync(statsPath, "utf-8"));
const kb = (n) => `${Math.round(n / 1024)} KB`;
let failed = false;

function warn(text) {
  console.warn(`bundle: ${text}`);
  if (process.env.GITHUB_ACTIONS)
    console.log(`::warning title=Bundle size::${text}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `> [!WARNING]\n> ${text}\n`
    );
}

for (const [route, budget] of Object.entries(BUDGETS)) {
  const entry = stats.find((r) => r.route === route);
  if (!entry) {
    console.error(`bundle: no stats for ${route}; did the build run?`);
    failed = true;
    continue;
  }
  const bytes = entry.firstLoadUncompressedJsBytes;
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    // A Next.js upgrade that renames the field must not pass by default.
    console.error(`bundle: no firstLoadUncompressedJsBytes for ${route}`);
    failed = true;
  } else if (bytes > budget) {
    const over = Math.round(((bytes - budget) / budget) * 100);
    warn(
      `${route} loads ${kb(bytes)} of JS first, ${over}% over its ${kb(budget)} budget. ` +
        "If that's not worth it, load the heavy part with next/dynamic or import(); " +
        "`npx next experimental-analyze` shows what's in it."
    );
  } else {
    console.log(`bundle: ${route} ${kb(bytes)} of ${kb(budget)}`);
  }
}
process.exit(failed ? 1 : 0);
