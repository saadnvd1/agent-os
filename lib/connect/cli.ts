/**
 * agent-os connect — turn Connect on for this machine.
 *
 *   agent-os connect [--name "Studio Mac"]   link: asks for the code from runagentos.com
 *     (or AGENTOS_CONNECT_CODE, or piped on stdin; --code works but lands in shell history)
 *   agent-os connect                         already linked: links its tunnel again
 *   agent-os connect --on | --off            (also: agent-os disconnect)
 *
 * The machine key is made here and never leaves this machine. The Connect
 * service makes the machine's Cloudflare tunnel; a running AgentOS fetches
 * a fresh connector token and runs cloudflared itself.
 */

import os from "os";
import readline from "readline/promises";
import {
  connectDir,
  connectTunnelPort,
  readConnect,
  saveConnect,
  serverPort,
  setConnectEnabled,
} from "./config";
import { linkWithCode } from "./link";
import { checkApiUrl, requestTunnel } from "./control-api";

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};

/** The link code, kept out of argv and shell history where possible. */
async function linkCode(): Promise<string | undefined> {
  const code = process.env.AGENTOS_CONNECT_CODE || arg("--code");
  if (code) return code.trim();
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question(
      "  Link code (runagentos.com → Connect a machine): "
    );
    rl.close();
    return answer.trim() || undefined;
  }
  let piped = "";
  for await (const chunk of process.stdin) piped += chunk;
  return piped.trim() || undefined;
}

async function main() {
  if (process.argv.includes("--off") || process.argv.includes("--on")) {
    const on = process.argv.includes("--on");
    if (!setConnectEnabled(on)) throw new Error("this machine isn't enrolled");
    console.log(
      `\n  Connect ${on ? "on" : "off"}. A running AgentOS follows within seconds.\n`
    );
    return;
  }

  const dir = connectDir();
  const operator = process.env.AGENTOS_CONNECT_OPERATOR === "1";
  const port = connectTunnelPort(serverPort());
  if (!port) throw new Error("AGENTOS_CONNECT_PORT isn't a usable port");

  const read = readConnect(dir);
  let config;
  if (read.ok) {
    // Linked already: the signed call keeps its id, name and tunnel.
    config = read.files.config;
    checkApiUrl(config.apiUrl, operator);
    const { hostname } = await requestTunnel(
      config,
      read.files.machineKey,
      port
    );
    config = { ...config, hostname };
    saveConnect(config, dir);
  } else {
    const code = await linkCode();
    if (!code)
      throw new Error(
        "get a code from runagentos.com (Connect a machine), then run agent-os connect and paste it"
      );
    config = await linkWithCode({
      dir,
      code,
      name: arg("--name") || os.hostname(),
      port,
    });
  }
  console.log(`\n  Machine ${config.machineId}`);
  console.log(`  Address  https://${config.hostname}`);
  console.log(`  Keys     ${dir} (the private key never leaves this machine)`);
  console.log(
    "\n  AgentOS picks this up within seconds; the Devices page shows Connect.\n"
  );
}

main().catch((err) => {
  console.error(`  connect: ${(err as Error).message}`);
  process.exit(1);
});
