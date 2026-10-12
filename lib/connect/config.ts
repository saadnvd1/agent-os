/**
 * Connect's state on this machine, in ~/.agent-os/connect (or
 * AGENTOS_CONNECT_DIR). No connect.json means Connect is off.
 *
 *   connect.json  {machineId, hostname, apiUrl, enabled?}
 *   machine.key   Ed25519 private key: proves this machine to the Connect
 *                 service, and never leaves here
 *   bin/          the pinned cloudflared, checked against its SHA-256
 *
 * The tunnel's connector token is never written down: it's fetched fresh
 * each time the tunnel starts.
 */

import fs from "fs";
import os from "os";
import path from "path";

export interface ConnectConfig {
  machineId: string;
  /** m-<16 hex>.runagentos.com; empty until the service names it. */
  hostname: string;
  /** The Connect service this machine enrolled with (signed API calls). */
  apiUrl: string;
}

export interface ConnectFiles {
  config: ConnectConfig;
  machineKey: string;
}

/** The only shape of name a machine is reached at. */
export const MACHINE_HOST = /^m-[0-9a-f]{16}\.runagentos\.com$/;

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
  let raw: Partial<ConnectConfig> & { enabled?: boolean };
  try {
    raw = JSON.parse(fs.readFileSync(file("connect.json"), "utf8")) ?? {};
  } catch {
    return { ok: false, reason: `${file("connect.json")} is not valid JSON` };
  }
  if (typeof raw.machineId !== "string" || !raw.machineId) {
    return {
      ok: false,
      reason: `${file("connect.json")} is missing machineId`,
    };
  }
  if (typeof raw.apiUrl !== "string" || !raw.apiUrl) {
    return {
      ok: false,
      reason: `${file("connect.json")} has no Connect service (run agent-os connect with a link code)`,
    };
  }
  if (!fs.existsSync(file("machine.key")))
    return {
      ok: false,
      reason: `${file("machine.key")} is missing (run agent-os connect)`,
    };
  // A name from before the tunnel (or anything else) is dropped: the next
  // start asks the service again.
  const hostname =
    typeof raw.hostname === "string" && MACHINE_HOST.test(raw.hostname)
      ? raw.hostname
      : "";
  return {
    ok: true,
    enabled: raw.enabled !== false,
    files: {
      config: { machineId: raw.machineId, hostname, apiUrl: raw.apiUrl },
      machineKey: fs.readFileSync(file("machine.key"), "utf8"),
    },
  };
}

export function loadConnect(dir = connectDir()): ConnectFiles | null {
  const r = readConnect(dir);
  return r.ok && r.enabled ? r.files : null;
}

/** Writes connect.json owner-only, keeping `enabled` as it was. */
export function saveConnect(config: ConnectConfig, dir = connectDir()) {
  const p = path.join(dir, "connect.json");
  let enabled: boolean | undefined;
  try {
    enabled = JSON.parse(fs.readFileSync(p, "utf8"))?.enabled;
  } catch {}
  const next = {
    machineId: config.machineId,
    hostname: config.hostname,
    apiUrl: config.apiUrl,
    ...(enabled === false && { enabled }),
  };
  fs.writeFileSync(p, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.chmodSync(p, 0o600);
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

/**
 * The loopback port cloudflared delivers tunnel traffic to: AgentOS's port
 * + 433 (3444), or AGENTOS_CONNECT_PORT. Null when it isn't usable.
 */
export function connectTunnelPort(
  port: number,
  env: Record<string, string | undefined> = process.env
): number | null {
  const p = Number(env.AGENTOS_CONNECT_PORT || port + 433);
  return Number.isInteger(p) && p > 0 && p < 65536 && p !== port ? p : null;
}
