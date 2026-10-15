/**
 * When the server started, and what it was doing when the last one stopped.
 * A restart is invisible from inside the new process, and a signal handler
 * would change how the old one exits, so each health tick leaves a
 * heartbeat (when it last ran, and the background jobs then live) and the
 * next boot reads it back.
 */

import { db } from "../db";
import { gitSync } from "../git-exec";
import { getSetting, putSetting } from "../settings-store";
import { MIN } from "./types";

const HEARTBEAT = "health.heartbeat";

export interface Heartbeat {
  at: number;
  bg: string[];
}

export function leaveHeartbeat(at: number, bg: string[]): void {
  putSetting(HEARTBEAT, JSON.stringify({ at, bg: bg.slice(0, 20) }));
}

function lastHeartbeat(): Heartbeat | null {
  try {
    const raw = getSetting(HEARTBEAT);
    return raw ? (JSON.parse(raw) as Heartbeat) : null;
  } catch {
    return null;
  }
}

function gitHead(): string | null {
  try {
    return gitSync(process.cwd(), ["rev-parse", "--short", "HEAD"], {
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

export function recordBoot(now = Date.now(), pid = process.pid): void {
  const prev = lastHeartbeat();
  db.prepare(
    `INSERT INTO health_boots (started_at, pid, head, prev_seen_at, prev_bg)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    now,
    pid,
    gitHead(),
    prev?.at ?? null,
    prev ? JSON.stringify(prev.bg) : null
  );
}

export interface BootRow {
  id: number;
  started_at: number;
  pid: number;
  head: string | null;
  prev_seen_at: number | null;
  prev_bg: string | null;
}

export const bootsSince = (since: number) =>
  db
    .prepare(
      `SELECT * FROM health_boots WHERE started_at >= ? ORDER BY started_at`
    )
    .all(since) as BootRow[];

export const recentBoots = (n = 6) =>
  db
    .prepare(`SELECT * FROM health_boots ORDER BY started_at DESC LIMIT ?`)
    .all(n) as BootRow[];

export const BOOT_WINDOW_MS = 24 * 60 * MIN;
