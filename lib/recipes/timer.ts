// A recipe's timer is a `schedules` row of kind "recipe": the Schedules
// engine (ticker, lease, slot claiming, catch-up, brake retry) runs it.

import { randomUUID } from "crypto";
import { db } from "../db";
import {
  cronError,
  DEFAULT_TIMEZONE,
  describeCron,
  isTimezone,
  MIN_GAP_MINUTES,
  minGapMinutes,
} from "../schedules/cron";
import { nextRunAt } from "../schedules/scheduler";
import { getSchedule } from "../schedules/store";
import type { Recipe, RecipeTimer } from "./types";

export interface TimerInput {
  cron: string;
  timezone?: string;
  enabled?: boolean;
}

function timerRowId(recipeId: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM schedules WHERE recipe_id = ? AND archived_at IS NULL`
    )
    .get(recipeId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function getTimer(
  recipeId: string,
  now = Date.now()
): RecipeTimer | null {
  const id = timerRowId(recipeId);
  const s = id ? getSchedule(id) : null;
  if (!s) return null;
  return {
    scheduleId: s.id,
    cron: s.cron,
    timezone: s.timezone,
    enabled: s.enabled,
    description: describeCron(s.cron),
    nextRunAt: nextRunAt(s, now),
  };
}

// Only Saad sets a recurring trigger: the orchestrator's tools have no way
// in here.
export function setTimer(
  recipe: Recipe,
  input: TimerInput | null,
  now = Date.now()
): RecipeTimer | null {
  const existing = timerRowId(recipe.id);
  if (input === null) {
    if (existing)
      db.prepare(
        `UPDATE schedules SET enabled = 0, archived_at = datetime('now') WHERE id = ?`
      ).run(existing);
    return null;
  }
  const cron = input.cron.trim().replace(/\s+/g, " ");
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
  if (!isTimezone(timezone)) throw new Error(`Unknown time zone "${timezone}"`);
  const bad = cronError(cron);
  if (bad) throw new Error(bad);
  if (
    minGapMinutes(cron, timezone, Date.now(), MIN_GAP_MINUTES) < MIN_GAP_MINUTES
  )
    throw new Error("A recipe runs at most once an hour");
  const enabled = input.enabled ?? true;
  if (!existing) {
    db.prepare(
      `INSERT INTO schedules (id, workspace_id, project_id, name, cron, timezone, prompt, kind, recipe_id, enabled, armed_at)
       VALUES (?, ?, ?, ?, ?, ?, '', 'recipe', ?, ?, ?)`
    ).run(
      randomUUID(),
      recipe.workspace_id,
      recipe.project_id,
      recipe.name,
      cron,
      timezone,
      recipe.id,
      enabled ? 1 : 0,
      now
    );
  } else {
    const current = getSchedule(existing)!;
    // A new time or a fresh enable counts from now: no earlier slot is
    // "missed".
    const rearm =
      cron !== current.cron ||
      timezone !== current.timezone ||
      (enabled && !current.enabled);
    db.prepare(
      `UPDATE schedules SET cron = ?, timezone = ?, enabled = ?, armed_at = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      cron,
      timezone,
      enabled ? 1 : 0,
      rearm ? now : current.armed_at,
      existing
    );
  }
  return getTimer(recipe.id, now);
}
