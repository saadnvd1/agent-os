/**
 * First-run welcome: shown once on a fresh install, never on one that
 * already has work. Completion is the server's (one server, many devices),
 * kept in `settings` as an ISO time, or "existing-install" when the install
 * was already in use.
 */

import type Database from "better-sqlite3";
import { db } from "./db";

export const WELCOME_KEY = "welcome.completed_at";
export const EXISTING_INSTALL = "existing-install";

export interface WelcomeGate {
  // The welcome should open now.
  show: boolean;
  // No sessions and no project of the user's own.
  fresh: boolean;
  completedAt: string | null;
}

export interface GateInput {
  completedAt: string | null;
  sessionCount: number;
  // Projects other than the built-in Uncategorized one.
  projectCount: number;
  demo: boolean;
  skip: boolean;
}

export function welcomeGate(i: GateInput): WelcomeGate {
  const fresh = i.sessionCount === 0 && i.projectCount === 0;
  return {
    show: !i.completedAt && fresh && !i.demo && !i.skip,
    fresh,
    completedAt: i.completedAt,
  };
}

export function readCompletedAt(d: Database.Database = db): string | null {
  const row = d
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(WELCOME_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

// Keeps the first stamp unless `overwrite`.
export function completeWelcome(
  value: string = new Date().toISOString(),
  d: Database.Database = db,
  overwrite = false
): void {
  d.prepare(
    overwrite
      ? `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      : `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
  ).run(WELCOME_KEY, value);
}

export function counts(d: Database.Database = db) {
  const n = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  return {
    sessionCount: n(`SELECT COUNT(*) AS n FROM sessions`),
    projectCount: n(
      `SELECT COUNT(*) AS n FROM projects WHERE is_uncategorized = 0`
    ),
  };
}

/** The gate for this server. An install found in use is stamped as such. */
export function readWelcomeGate(
  demo: boolean,
  d: Database.Database = db
): WelcomeGate {
  const c = counts(d);
  let completedAt = readCompletedAt(d);
  if (!completedAt && (c.sessionCount > 0 || c.projectCount > 0)) {
    completeWelcome(EXISTING_INSTALL, d);
    completedAt = readCompletedAt(d);
  }
  return welcomeGate({
    completedAt,
    ...c,
    demo,
    skip: !!process.env.AGENTOS_SKIP_WELCOME,
  });
}
