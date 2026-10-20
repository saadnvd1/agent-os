/** Entry for agent-os link / unlink (lib/peer/link-cli.ts). Argv: port, then the command. */

import { createInterface } from "readline/promises";
import { runLinkCli } from "./link-cli";

const [port, ...args] = process.argv.slice(2);
runLinkCli(args, {
  base: `http://127.0.0.1:${Number(port) || 3011}`,
  fetch,
  out: (line) => console.log(line),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  ask: async (prompt) => {
    if (!process.stdin.isTTY) return null;
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  },
}).then((code) => process.exit(code));
