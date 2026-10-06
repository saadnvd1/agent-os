/**
 * Connect's state on this machine, in ~/.agent-os/connect (or
 * AGENTOS_CONNECT_DIR). No connect.json means Connect is off.
 *
 *   connect.json  {machineId, hostname, relayUrl, relayServername?, relayCa?}
 *   machine.key   Ed25519 private key: proves this machine to the relay
 *   tls.key/.crt  the certificate phones see; the key never leaves here
 */

import fs from "fs";
import os from "os";
import path from "path";

export interface ConnectConfig {
  machineId: string;
  hostname: string;
  relayUrl: string;
  /** SNI to present to the relay when relayUrl is an IP (tests). */
  relayServername?: string;
  /** PEM of a private CA the relay's certificate chains to (tests). */
  relayCa?: string;
}

export interface ConnectFiles {
  config: ConnectConfig;
  machineKey: string;
  tls: { key: string; cert: string };
}

export const connectDir = () =>
  process.env.AGENTOS_CONNECT_DIR ||
  path.join(os.homedir(), ".agent-os", "connect");

export function loadConnect(dir = connectDir()): ConnectFiles | null {
  const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
  try {
    return {
      config: JSON.parse(read("connect.json")) as ConnectConfig,
      machineKey: read("machine.key"),
      tls: { key: read("tls.key"), cert: read("tls.crt") },
    };
  } catch {
    return null;
  }
}
