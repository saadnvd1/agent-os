/**
 * Paired devices. A device holds a random token; only its SHA-256 is stored,
 * so a copy of the database can't be replayed as a login.
 */

import crypto from "crypto";
import { getDb } from "@/lib/db";
import { enabledCategories } from "@/lib/notify/copy";
import type {
  PushCategory,
  PushEnvironment,
  PushPlatform,
} from "@/lib/notify/push-types";

export interface Device {
  id: string;
  name: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_address: string | null;
  revoked_at: string | null;
  // Saad let it answer the orchestrator's asks (off by default).
  can_approve: number;
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
        `SELECT id, name, user_agent, created_at, last_seen_at, last_address, revoked_at, can_approve
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

/** True when it actually wrote (at most once a minute per device). */
export function touchDevice(id: string, address?: string): boolean {
  const now = Date.now();
  if (now - (lastTouch.get(id) ?? 0) < TOUCH_EVERY_MS) return false;
  lastTouch.set(id, now);
  getDb()
    .prepare(
      `UPDATE devices SET last_seen_at = datetime('now'), last_address = ? WHERE id = ?`
    )
    .run(address ?? null, id);
  return true;
}

export function listDevices(): Device[] {
  return getDb()
    .prepare(
      `SELECT id, name, user_agent, created_at, last_seen_at, last_address, revoked_at, can_approve
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

export function setDeviceCanApprove(id: string, on: boolean): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE devices SET can_approve = ? WHERE id = ? AND revoked_at IS NULL`
      )
      .run(on ? 1 : 0, id).changes > 0
  );
}

export function revokeDevice(id: string): boolean {
  const changed =
    getDb()
      .prepare(
        `UPDATE devices SET revoked_at = datetime('now'),
           push_token = NULL, push_platform = NULL, push_environment = NULL,
           push_categories = NULL, push_updated_at = NULL, push_last_error = NULL
         WHERE id = ? AND revoked_at IS NULL`
      )
      .run(id).changes > 0;
  if (changed) dropDeviceSockets(id);
  return changed;
}

export interface DevicePush {
  token: string;
  platform: PushPlatform;
  environment: PushEnvironment;
  /** What it receives: its saved list, or the defaults. */
  categories: PushCategory[];
  updatedAt: string;
  lastError: string | null;
}

interface PushRow {
  push_token: string | null;
  push_platform: PushPlatform;
  push_environment: PushEnvironment;
  push_categories: string | null;
  push_updated_at: string;
  push_last_error: string | null;
}

// A corrupt saved list reads as "none saved", so the defaults apply.
function parseCategories(raw: string | null): unknown[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const pushOf = (r: PushRow | undefined): DevicePush | null =>
  r?.push_token
    ? {
        token: r.push_token,
        platform: r.push_platform,
        environment: r.push_environment,
        categories: enabledCategories(parseCategories(r.push_categories)),
        updatedAt: r.push_updated_at,
        lastError: r.push_last_error,
      }
    : null;

const PUSH_COLS = `push_token, push_platform, push_environment, push_categories,
  push_updated_at, push_last_error`;

export function getDevicePush(id: string): DevicePush | null {
  return pushOf(
    getDb()
      .prepare(
        `SELECT ${PUSH_COLS} FROM devices WHERE id = ? AND revoked_at IS NULL`
      )
      .get(id) as PushRow | undefined
  );
}

/** Every live device that can be sent a push, for the sender. */
export function listPushDevices(): { id: string; push: DevicePush }[] {
  const rows = getDb()
    .prepare(
      `SELECT id, ${PUSH_COLS} FROM devices
       WHERE revoked_at IS NULL AND push_token IS NOT NULL`
    )
    .all() as (PushRow & { id: string })[];
  return rows.flatMap((r) => {
    const push = pushOf(r);
    return push ? [{ id: r.id, push }] : [];
  });
}

/**
 * Registers or refreshes a device's push token. Idempotent. Saved categories
 * are kept unless new ones are given. A token belongs to one device: if
 * another row held it (a re-pair on the same phone), that row loses it so
 * nothing is sent twice.
 */
export function setDevicePush(
  id: string,
  p: {
    token: string;
    platform: PushPlatform;
    environment: PushEnvironment;
    categories?: PushCategory[];
  }
): boolean {
  const db = getDb();
  return db.transaction(() => {
    db.prepare(
      `UPDATE devices SET push_token = NULL, push_platform = NULL,
         push_environment = NULL, push_categories = NULL,
         push_updated_at = NULL, push_last_error = NULL
       WHERE push_token = ? AND id != ?`
    ).run(p.token, id);
    return (
      db
        .prepare(
          `UPDATE devices SET push_token = ?, push_platform = ?, push_environment = ?,
             push_categories = COALESCE(?, push_categories),
             push_updated_at = datetime('now'), push_last_error = NULL
           WHERE id = ? AND revoked_at IS NULL`
        )
        .run(
          p.token,
          p.platform,
          p.environment,
          p.categories ? JSON.stringify(p.categories) : null,
          id
        ).changes > 0
    );
  })();
}

/** False when the device has no push registered. */
export function setDevicePushCategories(
  id: string,
  categories: PushCategory[]
): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE devices SET push_categories = ?, push_updated_at = datetime('now')
         WHERE id = ? AND revoked_at IS NULL AND push_token IS NOT NULL`
      )
      .run(JSON.stringify(categories), id).changes > 0
  );
}

/** The sender records why a send failed, so the Devices page can say. */
export function setDevicePushError(id: string, error: string | null): void {
  getDb()
    .prepare(`UPDATE devices SET push_last_error = ? WHERE id = ?`)
    .run(error ? error.slice(0, 200) : null, id);
}

export function clearDevicePush(id: string): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE devices SET push_token = NULL, push_platform = NULL,
           push_environment = NULL, push_categories = NULL,
           push_updated_at = NULL, push_last_error = NULL
         WHERE id = ? AND push_token IS NOT NULL`
      )
      .run(id).changes > 0
  );
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
