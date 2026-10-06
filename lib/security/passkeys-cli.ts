/**
 * agent-os passkeys reset: the recovery path when no passkey is left (or
 * one that isn't yours got in). It revokes every passkey and lets the next
 * one be trusted on first use again. A person runs it, at a terminal on
 * this machine, outside any AgentOS session.
 */

import readline from "readline";
import { raisePasskeyAsks } from "../orchestrator/passkey-asks";
import { resetPasskeys } from "./passkeys";
import { RESET_PHRASE, resetRefusal } from "./passkeys-reset";

async function main() {
  if (process.argv[2] !== "reset") {
    console.error("Usage: agent-os passkeys reset");
    process.exit(2);
  }
  const refused = resetRefusal(
    process.env,
    !!process.stdin.isTTY && !!process.stdout.isTTY
  );
  if (refused) {
    console.error(`\n  ${refused}\n`);
    process.exit(1);
  }
  console.log(`
  ================================================================
   WARNING: this revokes EVERY AgentOS passkey.

   Until you add a new one, the next passkey registered from this
   machine, the tailnet or an approved device is trusted on first
   use, and whoever adds it can approve merges, brakes and anything
   on a hard line. Add yours right after this, in Devices.
  ================================================================
`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`  Type "${RESET_PHRASE}" to continue: `, resolve)
  );
  rl.close();
  if (answer.trim() !== RESET_PHRASE) {
    console.log("\n  Nothing changed.\n");
    return;
  }
  const n = resetPasskeys();
  raisePasskeyAsks(
    { id: `reset-${Date.now()}`, name: "every passkey", rp_id: "every host" },
    "this machine",
    "reset"
  );
  console.log(
    `\n  Revoked ${n} passkey${n === 1 ? "" : "s"}. Add yours now: Devices > Passkeys > Add a passkey here.\n`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
