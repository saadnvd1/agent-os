/**
 * Turning Connect on for this machine. Everything secret is generated here
 * and written only to the Connect folder (owner-only): the Ed25519 key that
 * proves the machine to the relay, and the TLS key for <id>.<domain> that
 * phones complete TLS with. Neither is ever sent anywhere; the certificate
 * authority only sees a signing request.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import acme from "acme-client";
import { connectDir, type ConnectConfig } from "./config";
import { generateMachineKey } from "./identity";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newMachineId(): string {
  return Array.from(crypto.randomBytes(8), (b) => ID_ALPHABET[b % 36]).join("");
}

const write = (dir: string, file: string, data: string) =>
  fs.writeFileSync(path.join(dir, file), data, { mode: 0o600 });

export interface Enrolment {
  config: ConnectConfig;
  machinePublicKey: string;
  csr: Buffer;
}

/** Creates the machine's identity and TLS key, or reuses them if present. */
export async function enrol(opts: {
  domain: string;
  relayUrl: string;
  dir?: string;
}): Promise<Enrolment> {
  const dir = opts.dir ?? connectDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const configPath = path.join(dir, "connect.json");
  let config: ConnectConfig;
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8")) as ConnectConfig;
  } else {
    const machineId = newMachineId();
    config = {
      machineId,
      hostname: `${machineId}.${opts.domain}`,
      relayUrl: opts.relayUrl,
    };
  }
  if (!fs.existsSync(path.join(dir, "machine.key"))) {
    write(dir, "machine.key", generateMachineKey().privateKey);
  }
  if (!fs.existsSync(path.join(dir, "tls.key"))) {
    write(
      dir,
      "tls.key",
      (await acme.crypto.createPrivateEcdsaKey()).toString()
    );
  }
  const machinePublicKey = crypto
    .createPublicKey(fs.readFileSync(path.join(dir, "machine.key"), "utf8"))
    .export({ type: "spki", format: "pem" })
    .toString();
  const [, csr] = await acme.crypto.createCsr(
    { commonName: config.hostname, altNames: [config.hostname] },
    fs.readFileSync(path.join(dir, "tls.key"))
  );
  write(dir, "connect.json", JSON.stringify(config, null, 2));
  return { config, machinePublicKey, csr };
}

/** Where DNS-01 TXT records get written: the control plane's broker, or (dev) a DNS API. */
export interface DnsChallenge {
  set(name: string, value: string): Promise<void>;
  clear(name: string, value: string): Promise<void>;
}

/** Gets a certificate for the CSR over ACME DNS-01 and stores it as tls.crt. */
export async function certify(opts: {
  csr: Buffer;
  dns: DnsChallenge;
  dir?: string;
  directoryUrl?: string;
}): Promise<void> {
  const dir = opts.dir ?? connectDir();
  const accountKeyPath = path.join(dir, "acme-account.key");
  if (!fs.existsSync(accountKeyPath)) {
    write(
      dir,
      "acme-account.key",
      (await acme.crypto.createPrivateKey()).toString()
    );
  }
  const client = new acme.Client({
    directoryUrl: opts.directoryUrl ?? acme.directory.letsencrypt.production,
    accountKey: fs.readFileSync(accountKeyPath),
  });
  const cert = await client.auto({
    csr: opts.csr,
    termsOfServiceAgreed: true,
    challengePriority: ["dns-01"],
    challengeCreateFn: async (authz, _c, keyAuth) =>
      opts.dns.set(`_acme-challenge.${authz.identifier.value}`, keyAuth),
    challengeRemoveFn: async (authz, _c, keyAuth) =>
      opts.dns.clear(`_acme-challenge.${authz.identifier.value}`, keyAuth),
  });
  write(dir, "tls.crt", cert);
}
