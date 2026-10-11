/**
 * Stall alerts: a chat turn silent for this long (no token, tool call or
 * result) is flagged "stalled" in the UI and reported once to its workspace's
 * orchestrator (lib/orchestrator/conditions). App-wide, in Settings →
 * Workspaces. 0 is off.
 */

import { db } from "../db";
import {
  DEFAULT_STALL_MINUTES,
  MAX_STALL_MINUTES,
  MIN_STALL_MINUTES,
} from "./stall-limits";

export const STALL_KEY = "chat.stall_minutes";

export function stallMinutes(): number {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(STALL_KEY) as { value: string } | undefined;
  const n = row ? Number(row.value) : DEFAULT_STALL_MINUTES;
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_STALL_MINUTES;
}

export const stallThresholdMs = () => stallMinutes() * 60_000;

// 0 (off) or a whole number of minutes in range. Throws a plain message
// otherwise.
export function checkStallMinutes(value: unknown): number {
  if (value === 0) return 0;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_STALL_MINUTES ||
    value > MAX_STALL_MINUTES
  )
    throw new Error(
      `The stall alert is off or between ${MIN_STALL_MINUTES} and ${MAX_STALL_MINUTES} minutes`
    );
  return value;
}

export function setStallMinutes(value: unknown): number {
  const minutes = checkStallMinutes(value);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(STALL_KEY, String(minutes));
  return minutes;
}
