/** Entry for agent-os link / unlink (lib/peer/link-cli.ts). Argv: port, then the command. */

import { runLinkCli } from "./link-cli";

const [port, ...args] = process.argv.slice(2);
runLinkCli(args, {
  base: `http://127.0.0.1:${Number(port) || 3011}`,
  fetch,
  out: (line) => console.log(line),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}).then((code) => process.exit(code));
