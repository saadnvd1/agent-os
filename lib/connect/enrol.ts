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

const SECRETS = ["machine.key", "tls.key", "acme-account.key"];

const write = (dir: string, file: string, data: string) => {
  fs.writeFileSync(path.join(dir, file), data, { mode: 0o600 });
  fs.chmodSync(path.join(dir, file), 0o600);
};

/** Owner-only, every time: a folder or key loosened later is tightened again. */
function lockDown(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  for (const f of SECRETS) {
    if (fs.existsSync(path.join(dir, f)))
      fs.chmodSync(path.join(dir, f), 0o600);
  }
}

export interface Enrolment {
  config: ConnectConfig;
  machinePublicKey: string;
  csr: Buffer;
}

/** Who names this machine: the Connect service (from a link code), or local (operators). */
export type Register = (publicKey: string) => Promise<ConnectConfig>;

/**
 * Creates the machine's identity and TLS key, or reuses them if present.
 * The machine key comes first: the Connect service registers its public
 * half and answers with the machine's id and address.
 */
export async function enrol(opts: {
  domain: string;
  relayUrl: string;
  dir?: string;
  register?: Register;
}): Promise<Enrolment> {
  const dir = opts.dir ?? connectDir();
  lockDown(dir);
  if (!fs.existsSync(path.join(dir, "machine.key"))) {
    write(dir, "machine.key", generateMachineKey().privateKey);
  }
  const publicKey = crypto
    .createPublicKey(fs.readFileSync(path.join(dir, "machine.key"), "utf8"))
    .export({ type: "spki", format: "pem" })
    .toString();
  const configPath = path.join(dir, "connect.json");
  let config: ConnectConfig;
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8")) as ConnectConfig;
  } else {
    if (opts.register) {
      config = await opts.register(publicKey);
    } else {
      const machineId = newMachineId();
      config = {
        machineId,
        hostname: `${machineId}.${opts.domain}`,
        relayUrl: opts.relayUrl,
      };
    }
    // Saved before anything else can fail: the link code is single-use, so
    // a rerun must resume with this id rather than ask for a new code.
    write(dir, "connect.json", JSON.stringify(config, null, 2));
  }
  if (!fs.existsSync(path.join(dir, "tls.key"))) {
    write(
      dir,
      "tls.key",
      (await acme.crypto.createPrivateEcdsaKey()).toString()
    );
  }
  const machinePublicKey = publicKey;
  const [, csr] = await acme.crypto.createCsr(
    { commonName: config.hostname, altNames: [config.hostname] },
    fs.readFileSync(path.join(dir, "tls.key"))
  );
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
  lockDown(dir);
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
