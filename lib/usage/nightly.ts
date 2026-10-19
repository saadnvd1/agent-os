/**
 * The nightly rollup, inside the server, with no model: it imports the
 * transcripts it couldn't watch, rolls each recent day up, moves the
 * ratchet's baseline, and alerts once when the last days regressed. A light
 * pass every half hour keeps today's row (and cost on task cards) current.
 */

import { db } from "../db";
import { notifyPhone } from "../notify";
import { backfillCheckRuns } from "./calls";
import { readUsageConfig } from "./config";
import type { Gh } from "./quality";
import {
  applyAlertState,
  evaluateAlerts,
  loadBaseline,
  nextAlertState,
  nextBaseline,
  openAlerts,
  saveBaseline,
} from "./ratchet";
import { dayKey, dayStart, loadRollups, rollupDay, saveRollup } from "./rollup";
import { importTranscripts } from "./transcript-import";

const DAY = 24 * 3600 * 1000;
const LAST_RUN = "usage.last_nightly";
const TICK_MS = 30 * 60 * 1000;
// A day's escapes settle three days after it ends.
const SETTLE_MS = 3 * DAY;

export interface NightlyDeps {
  now: () => number;
  gh?: Gh;
  notify: (text: string) => void;
  transcriptsRoot?: string;
}

export const realDeps: NightlyDeps = {
  now: Date.now,
  notify: (text) => notifyPhone("usage", text),
};

const addDays = (day: string, n: number) =>
  dayKey(dayStart(day) + n * DAY + DAY / 2);

function setting(key: string): string | null {
  const r = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    { value: string } | undefined;
  return r?.value ?? null;
}

// Imports what's new and keeps today's row current.
export async function lightPass(deps: NightlyDeps): Promise<void> {
  const now = deps.now();
  const seeded = loadRollups(1).length > 0;
  await importTranscripts(
    now - (seeded ? 3 : readUsageConfig().baselineDays + 1) * DAY,
    400,
    deps.transcriptsRoot
  );
  backfillCheckRuns();
  const today = dayKey(now);
  saveRollup(await rollupDay(today, now, undefined), false, now);
}

// The once-a-day pass.
export async function nightly(deps: NightlyDeps): Promise<void> {
  const now = deps.now();
  const cfg = readUsageConfig();
  const today = dayKey(now);
  await lightPass(deps);
  const existing = loadRollups(60);
  const last = existing.filter((r) => r.day < today).at(-1)?.day;
  let day = last ? addDays(last, -3) : addDays(today, -cfg.baselineDays);
  for (; day < today; day = addDays(day, 1)) {
    const final = dayStart(day) + DAY + SETTLE_MS <= now;
    saveRollup(await rollupDay(day, now, deps.gh), final, now);
  }
  const complete = loadRollups(60).filter((r) => r.day < today);
  const baseline = nextBaseline(loadBaseline(), complete, cfg, now);
  if (baseline) saveBaseline(baseline);
  const state = nextAlertState(
    openAlerts(),
    evaluateAlerts(complete, baseline, cfg)
  );
  applyAlertState(state, now);
  for (const a of state.notify) deps.notify(a.message);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(LAST_RUN, today);
}

// Whether this server runs the rollup: a dev server only when asked, so it
// never alerts for a database that isn't real.
export function usageRollupEnabled(
  env: Record<string, string | undefined>
): boolean {
  const dev = env.AGENTOS_DEV === "1" || env.NODE_ENV !== "production";
  return dev
    ? env.AGENTOS_USAGE_ROLLUP === "on"
    : env.AGENTOS_USAGE_ROLLUP !== "off";
}

const g = globalThis as unknown as {
  __agentosUsage?: { stop: () => void };
  __agentosUsageBusy?: boolean;
};

// Runs a pass unless one is already running, in this process: the timer and
// the API route share the flag (on globalThis, as the server and the routes
// load separate copies of this module). Returns whether it ran.
export async function exclusive(pass: () => Promise<void>): Promise<boolean> {
  if (g.__agentosUsageBusy) return false;
  g.__agentosUsageBusy = true;
  try {
    await pass();
  } finally {
    g.__agentosUsageBusy = false;
  }
  return true;
}

export const usageBusy = () => !!g.__agentosUsageBusy;

// The due pass: the full one once a day, just after midnight.
const duePass = (deps: NightlyDeps) =>
  setting(LAST_RUN) !== dayKey(deps.now()) ? nightly(deps) : lightPass(deps);

export function startUsageRollup(deps: NightlyDeps = realDeps): {
  stop: () => void;
} {
  if (g.__agentosUsage) return g.__agentosUsage;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const run = () =>
    exclusive(() => duePass(deps)).catch((error) =>
      console.error("[usage] rollup failed:", error)
    );
  const next = () => {
    if (stopped) return;
    timer = setTimeout(() => void run().finally(next), TICK_MS);
    timer.unref();
  };
  // Not at boot: the server is busy resuming sessions then.
  timer = setTimeout(() => void run().finally(next), 60_000);
  timer.unref();
  g.__agentosUsage = {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      g.__agentosUsage = undefined;
    },
  };
  return g.__agentosUsage;
}
