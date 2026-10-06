/**
 * Paired devices. A device holds a random token; only its SHA-256 is stored,
 * so a copy of the database can't be replayed as a login.
 */

import crypto from "crypto";
import { getDb } from "@/lib/db";

export interface Device {
  id: string;
  name: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_address: string | null;
  revoked_at: string | null;
}

const TOKEN_PREFIX = "aosd_";
const TOUCH_EVERY_MS = 60_000;

export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export function mintDevice(
  name: string,
  userAgent?: string | null
): { device: Device; token: string } {
  const id = crypto.randomUUID();
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  getDb()
    .prepare(
      `INSERT INTO devices (id, name, token_hash, user_agent) VALUES (?, ?, ?, ?)`
    )
    .run(
      id,
      name.trim().slice(0, 80) || "Device",
      hashToken(token),
      userAgent ?? null
    );
  return { device: getDevice(id)!, token };
}

export function getDevice(id: string): Device | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, name, user_agent, created_at, last_seen_at, last_address, revoked_at
         FROM devices WHERE id = ?`
      )
      .get(id) as Device | undefined) ?? null
  );
}

export function deviceForToken(token: string): { id: string } | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  return (
    (getDb()
      .prepare(
        `SELECT id FROM devices WHERE token_hash = ? AND revoked_at IS NULL`
      )
      .get(hashToken(token)) as { id: string } | undefined) ?? null
  );
}

const lastTouch = new Map<string, number>();

export function touchDevice(id: string, address?: string): void {
  const now = Date.now();
  if (now - (lastTouch.get(id) ?? 0) < TOUCH_EVERY_MS) return;
  lastTouch.set(id, now);
  getDb()
    .prepare(
      `UPDATE devices SET last_seen_at = datetime('now'), last_address = ? WHERE id = ?`
    )
    .run(address ?? null, id);
}

export function listDevices(): Device[] {
  return getDb()
    .prepare(
      `SELECT id, name, user_agent, created_at, last_seen_at, last_address, revoked_at
       FROM devices WHERE revoked_at IS NULL ORDER BY created_at DESC`
    )
    .all() as Device[];
}

export function renameDevice(id: string, name: string): boolean {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return false;
  return (
    getDb()
      .prepare(
        `UPDATE devices SET name = ? WHERE id = ? AND revoked_at IS NULL`
      )
      .run(trimmed, id).changes > 0
  );
}

export function revokeDevice(id: string): boolean {
  const changed =
    getDb()
      .prepare(
        `UPDATE devices SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`
      )
      .run(id).changes > 0;
  if (changed) dropDeviceSockets(id);
  return changed;
}

// Open WebSockets per device, so revoking one cuts its live terminal too.
// On globalThis because server.ts and Next's route bundles load this module
// separately.
type Closable = {
  destroy: () => void;
  once: (e: "close", f: () => void) => unknown;
};
const g = globalThis as unknown as {
  __agentosDeviceSockets?: Map<string, Set<Closable>>;
};
const sockets: Map<string, Set<Closable>> = (g.__agentosDeviceSockets ??=
  new Map());

export function trackDeviceSocket(id: string, socket: Closable): void {
  const set = sockets.get(id) ?? new Set();
  set.add(socket);
  sockets.set(id, set);
  socket.once("close", () => set.delete(socket));
}

function dropDeviceSockets(id: string): void {
  for (const s of sockets.get(id) ?? []) s.destroy();
  sockets.delete(id);
}
