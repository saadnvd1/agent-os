/**
 * agent-os connect — turn Connect on for this machine.
 *
 * Until the Connect service enrols machines itself, this does the machine's
 * half: creates its keys (they never leave this machine), and, given a
 * zone-scoped DNS token in CONNECT_DNS_TOKEN (operators only), gets its
 * certificate. It prints the public key the relay needs to know.
 */

import fs from "fs";
import path from "path";
import { connectDir } from "./config";
import { certify, enrol } from "./enrol";
import { cloudflareDns } from "./cloudflare-dns";

const ZONE = "runagentos.com";
const domain = process.env.CONNECT_MACHINE_DOMAIN || `on.${ZONE}`;
const relayUrl = process.env.CONNECT_RELAY_URL || `wss://relay.${ZONE}`;

async function main() {
  const { config, machinePublicKey, csr } = await enrol({ domain, relayUrl });
  const dir = connectDir();
  const pubPath = path.join(dir, "machine.pub");
  fs.writeFileSync(pubPath, machinePublicKey, { mode: 0o644 });

  console.log(`\n  Machine ${config.machineId}`);
  console.log(`  Address  https://${config.hostname}`);
  console.log(`  Keys     ${dir} (private keys never leave this machine)`);

  const token = process.env.CONNECT_DNS_TOKEN;
  if (
    fs.existsSync(path.join(dir, "tls.crt")) &&
    !process.argv.includes("--renew")
  ) {
    console.log("  Cert     already present (--renew to get a new one)");
  } else if (token) {
    console.log("  Cert     asking Let's Encrypt (DNS-01)...");
    await certify({ csr, dns: cloudflareDns(token, ZONE) });
    console.log("  Cert     saved");
  } else {
    console.log(
      "  Cert     not yet: needs the Connect service (or CONNECT_DNS_TOKEN)"
    );
  }
  console.log(`\n  Public key for the relay: ${pubPath}`);
  console.log("  Restart AgentOS to start the tunnel.\n");
}

main().catch((err) => {
  console.error(`  connect: ${(err as Error).message}`);
  process.exit(1);
});
