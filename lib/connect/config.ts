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

export type ConnectRead =
  | { ok: true; files: ConnectFiles; enabled: boolean }
  | { ok: false; reason: string };

/** Reads the Connect folder, saying exactly what's wrong when it can't. */
export function readConnect(dir = connectDir()): ConnectRead {
  const file = (f: string) => path.join(dir, f);
  if (!fs.existsSync(file("connect.json")))
    return { ok: false, reason: "not enrolled" };
  let config: ConnectConfig & { enabled?: boolean };
  try {
    config = JSON.parse(fs.readFileSync(file("connect.json"), "utf8"));
  } catch {
    return { ok: false, reason: `${file("connect.json")} is not valid JSON` };
  }
  if (!config.machineId || !config.hostname || !config.relayUrl) {
    return {
      ok: false,
      reason: `${file("connect.json")} is missing machineId, hostname or relayUrl`,
    };
  }
  for (const f of ["machine.key", "tls.key", "tls.crt"]) {
    if (!fs.existsSync(file(f)))
      return {
        ok: false,
        reason: `${file(f)} is missing (run agent-os connect)`,
      };
  }
  return {
    ok: true,
    enabled: config.enabled !== false,
    files: {
      config,
      machineKey: fs.readFileSync(file("machine.key"), "utf8"),
      tls: {
        key: fs.readFileSync(file("tls.key"), "utf8"),
        cert: fs.readFileSync(file("tls.crt"), "utf8"),
      },
    },
  };
}

export function loadConnect(dir = connectDir()): ConnectFiles | null {
  const r = readConnect(dir);
  return r.ok && r.enabled ? r.files : null;
}

/** Turns Connect on or off without touching the keys. */
export function setConnectEnabled(
  enabled: boolean,
  dir = connectDir()
): boolean {
  const p = path.join(dir, "connect.json");
  if (!fs.existsSync(p)) return false;
  const config = JSON.parse(fs.readFileSync(p, "utf8"));
  fs.writeFileSync(p, JSON.stringify({ ...config, enabled }, null, 2), {
    mode: 0o600,
  });
  return true;
}
