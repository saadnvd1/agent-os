/**
 * Turning Connect on for this machine. The Ed25519 key that proves the
 * machine to the Connect service is generated here and written only to the
 * Connect folder (owner-only); only its public half is ever sent.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { connectDir, saveConnect, type ConnectConfig } from "./config";

const write = (dir: string, file: string, data: string) => {
  fs.writeFileSync(path.join(dir, file), data, { mode: 0o600 });
  fs.chmodSync(path.join(dir, file), 0o600);
};

/** Owner-only, every time: a folder or key loosened later is tightened again. */
function lockDown(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  if (fs.existsSync(path.join(dir, "machine.key")))
    fs.chmodSync(path.join(dir, "machine.key"), 0o600);
}

export interface MachineKeys {
  publicKey: string;
  privateKey: string;
}

/** Registers the public key with the Connect service; answers id and name. */
export type Register = (keys: MachineKeys) => Promise<ConnectConfig>;

/** The machine key, made on first use and reused after. */
export function machineKeys(dir = connectDir()): MachineKeys {
  lockDown(dir);
  if (!fs.existsSync(path.join(dir, "machine.key"))) {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    write(
      dir,
      "machine.key",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    );
  }
  const privateKey = fs.readFileSync(path.join(dir, "machine.key"), "utf8");
  const publicKey = crypto
    .createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
  return { publicKey, privateKey };
}

/**
 * Creates the machine's identity (or reuses it) and registers it. The
 * service's answer is saved before anything else can fail: the link code
 * is single-use, so a rerun must resume with this id.
 */
export async function enrol(opts: {
  register: Register;
  dir?: string;
}): Promise<ConnectConfig> {
  const dir = opts.dir ?? connectDir();
  const config = await opts.register(machineKeys(dir));
  saveConnect(config, dir);
  return config;
}
