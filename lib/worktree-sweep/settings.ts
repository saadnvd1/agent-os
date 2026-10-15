/**
 * How many days a settled worktree stays before the sweep removes it.
 * Global, with a per-project override; 0 turns it off. Default 7.
 */

import { z } from "zod";
import { db } from "../db";
import type { ResolvedDays } from "./types";

export const DEFAULT_SWEEP_DAYS = 7;
export const MAX_SWEEP_DAYS = 365;

const GLOBAL_KEY = "worktree_sweep";
const projectKey = (projectId: string) => `worktree_sweep.project.${projectId}`;

export const sweepDays = z.number().int().min(0).max(MAX_SWEEP_DAYS);
const stored = z.object({ days: sweepDays });

function read(key: string): number | null {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    const got = stored.safeParse(JSON.parse(row.value));
    return got.success ? got.data.days : null;
  } catch {
    return null;
  }
}

function write(key: string, days: number | null): number | null {
  if (days === null) {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
    return null;
  }
  const got = sweepDays.safeParse(days);
  if (!got.success)
    throw new Error(
      `Days must be a whole number from 0 to ${MAX_SWEEP_DAYS} (0 turns the clean-up off)`
    );
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify({ days: got.data }));
  return got.data;
}

export const globalSweepDays = () => read(GLOBAL_KEY);
export const setGlobalSweepDays = (days: number | null) =>
  write(GLOBAL_KEY, days);
export const projectSweepDays = (projectId: string) =>
  read(projectKey(projectId));
export const setProjectSweepDays = (projectId: string, days: number | null) =>
  write(projectKey(projectId), days);

// The project's own setting, else the global one, else the default.
export function resolveSweepDays(
  projectId: string | null | undefined
): ResolvedDays {
  const own = projectId ? projectSweepDays(projectId) : null;
  if (own !== null) return { days: own, from: "project" };
  const global = globalSweepDays();
  if (global !== null) return { days: global, from: "global" };
  return { days: DEFAULT_SWEEP_DAYS, from: "default" };
}

// Projects with their own number, for the settings page.
export function projectSweepOverrides(): Array<{
  projectId: string;
  days: number;
}> {
  const rows = db
    .prepare(
      `SELECT key FROM settings WHERE key LIKE 'worktree_sweep.project.%'`
    )
    .all() as Array<{ key: string }>;
  return rows.flatMap(({ key }) => {
    const projectId = key.slice("worktree_sweep.project.".length);
    const days = read(key);
    return days === null ? [] : [{ projectId, days }];
  });
}
