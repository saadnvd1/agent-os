#!/usr/bin/env node
// agent-os pair: add a device from a terminal (for machines with no browser).
// Asks the local server for a one-time code, prints a QR code, and waits.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const QRCode = require("qrcode");
const base = `http://127.0.0.1:${process.argv[2] || 3011}`;

const res = await fetch(`${base}/api/pair/start`, { method: "POST" }).catch(
  () => null
);
if (!res?.ok) {
  console.error(
    `  Can't reach AgentOS at ${base}. Is it running? (agent-os status)`
  );
  process.exit(1);
}
const offer = await res.json();

if (offer.links.length === 0) {
  console.log("\n  No other device can reach this machine yet.");
  console.log(
    "  Turn on Wi-Fi access (AGENTOS_NETWORK=lan) or set up Tailscale, then run this again.\n"
  );
  process.exit(1);
}

const [first, ...others] = offer.links;
console.log(
  await QRCode.toString(first.link, { type: "terminal", small: true })
);
console.log(`  Scan it, or open ${first.base}/pair and type:\n`);
console.log(`      ${offer.display}\n`);
for (const l of others) console.log(`  Also reachable at ${l.base}/pair`);
console.log("  The code works once, for 10 minutes. Waiting...");

const status = `${base}/api/pair/status?code=${offer.code}`;
for (;;) {
  await new Promise((r) => setTimeout(r, 1500));
  const s = await fetch(status).then(
    (r) => r.json(),
    () => ({ state: "unknown" })
  );
  if (s.state === "claimed") {
    console.log(`\n  ${s.name} is paired.\n`);
    process.exit(0);
  }
  if (s.state !== "waiting") {
    console.log("\n  The code expired. Run agent-os pair again.\n");
    process.exit(1);
  }
}
