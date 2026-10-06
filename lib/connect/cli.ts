/**
 * agent-os connect — turn Connect on for this machine.
 *
 *   agent-os connect [--name "Studio Mac"]   enrol: asks for the code from runagentos.com
 *     (or AGENTOS_CONNECT_CODE, or piped on stdin; --code works but lands in shell history)
 *   agent-os connect --renew                                  get a fresh certificate
 *   agent-os connect --on | --off                             (also: agent-os disconnect)
 *
 * The machine key and the TLS key are made here and never leave this
 * machine. The certificate comes from Let's Encrypt over DNS-01, through
 * the Connect service's broker (which only touches this machine's name).
 * Operators may instead use a zone-scoped token: CONNECT_DNS_TOKEN with
 * AGENTOS_CONNECT_OPERATOR=1.
 */

import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline/promises";
import { connectDir, setConnectEnabled } from "./config";
import { certify, enrol, type DnsChallenge } from "./enrol";
import { cloudflareDns } from "./cloudflare-dns";
import {
  brokerDns,
  checkApiUrl,
  DEFAULT_API,
  registerWithCode,
} from "./control-api";

const ZONE = "runagentos.com";
const domain = process.env.CONNECT_MACHINE_DOMAIN || `on.${ZONE}`;
const relayUrl = process.env.CONNECT_RELAY_URL || `wss://relay.${ZONE}`;

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
  const token = process.env.CONNECT_DNS_TOKEN;
  const isOperator = process.env.AGENTOS_CONNECT_OPERATOR === "1";
  const operator = !!token && isOperator;
  const apiUrl = checkApiUrl(
    process.env.CONNECT_API_URL || DEFAULT_API,
    isOperator
  );
  if (token && !operator) {
    // A zone-wide DNS token can rewrite any machine's name. Only the operator's
    // own machines may use one; everyone else enrols through the Connect service.
    throw new Error(
      "CONNECT_DNS_TOKEN needs AGENTOS_CONNECT_OPERATOR=1 (operators only)"
    );
  }
  const enrolled = fs.existsSync(path.join(dir, "connect.json"));
  const code = enrolled
    ? undefined
    : operator
      ? process.env.AGENTOS_CONNECT_CODE || arg("--code")
      : await linkCode();
  if (!enrolled && !code && !operator) {
    throw new Error(
      "get a code from runagentos.com (Connect a machine), then run agent-os connect and paste it"
    );
  }

  const { config, csr } = await enrol({
    domain,
    relayUrl,
    register: code
      ? registerWithCode(apiUrl, code, arg("--name") || os.hostname(), domain)
      : undefined,
  });
  console.log(`\n  Machine ${config.machineId}`);
  console.log(`  Address  https://${config.hostname}`);
  console.log(`  Keys     ${dir} (private keys never leave this machine)`);

  if (
    fs.existsSync(path.join(dir, "tls.crt")) &&
    !process.argv.includes("--renew")
  ) {
    console.log("  Cert     already present (--renew to get a new one)");
  } else {
    const dns: DnsChallenge = config.apiUrl
      ? brokerDns(
          config,
          fs.readFileSync(path.join(dir, "machine.key"), "utf8")
        )
      : operator
        ? cloudflareDns(token!, ZONE)
        : (() => {
            throw new Error(
              "no way to prove this name: enrol with a link code"
            );
          })();
    console.log("  Cert     asking Let's Encrypt (DNS-01)...");
    await certify({ csr, dns });
    console.log("  Cert     saved");
  }
  console.log(
    "\n  AgentOS picks this up within seconds; the Devices page shows Connect.\n"
  );
}

main().catch((err) => {
  console.error(`  connect: ${(err as Error).message}`);
  process.exit(1);
});
