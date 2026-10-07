/**
 * The ticker: once a minute, in the main server process only, each enabled
 * schedule runs its latest due slot if nobody has yet. Looking at the latest
 * slot rather than the current minute is what catches up after downtime: a
 * server that was off through several slots runs only the most recent one,
 * once, and records it as caught up.
 */

import { nextRun, prevRun } from "./cron";
import { runSlot, slotKey, type RunDeps, type RunResult } from "./run";
import { randomUUID } from "crypto";
import {
  failAbandonedClaims,
  holdLease,
  listSchedules,
  slotTaken,
  type Schedule,
} from "./store";

// A slot from before this process started, or this late (a sleeping
// machine), counts as caught up rather than on time.
export const LATE_MS = 90 * 1000;

// The slot a schedule is due to run now, if any.
export function dueSlot(schedule: Schedule, now: number): number | null {
  if (!schedule.enabled || schedule.archived_at) return null;
  const slot = prevRun(schedule.cron, now, schedule.timezone);
  if (slot === null || slot <= schedule.armed_at) return null;
  return slotTaken(schedule.id, slotKey(slot)) ? null : slot;
}

export function nextRunAt(schedule: Schedule, now = Date.now()): number | null {
  if (!schedule.enabled) return null;
  return nextRun(
    schedule.cron,
    Math.max(now, schedule.armed_at),
    schedule.timezone
  );
}

export async function tick(
  deps: RunDeps,
  now = Date.now(),
  upSince = 0
): Promise<RunResult[]> {
  const results = await Promise.all(
    listSchedules().map(async (schedule) => {
      let slot: number | null;
      try {
        slot = dueSlot(schedule, now);
      } catch (error) {
        console.error(`[schedules] ${schedule.name}:`, error);
        return null;
      }
      if (slot === null) return null;
      return runSlot(
        schedule,
        slot,
        slot < upSince || now - slot > LATE_MS ? "catch-up" : "schedule",
        deps
      );
    })
  );
  return results.filter((r): r is RunResult => r !== null);
}

const g = globalThis as unknown as {
  __agentosScheduler?: { stop: () => void };
};

// Starts the ticker once per process: a tick now (catching up), then one
// just after each minute turns. Each tick first takes or renews the lease;
// a process that doesn't hold it (a second server on the same database)
// ticks nothing.
export function startScheduler(deps: RunDeps): { stop: () => void } {
  if (g.__agentosScheduler) return g.__agentosScheduler;
  let timer: NodeJS.Timeout | undefined;
  let busy = false;
  let stopped = false;
  const upSince = Date.now();
  const owner = `${process.pid}-${randomUUID()}`;
  let holding = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!holdLease(owner)) {
        holding = false;
        return;
      }
      // Newly the ticker: claims the last holder left never started; no
      // one will finish them now.
      if (!holding) failAbandonedClaims(0);
      holding = true;
      await tick(deps, Date.now(), upSince);
    } catch (error) {
      console.error("[schedules] tick failed:", error);
    } finally {
      busy = false;
    }
  };
  const schedule = () => {
    if (stopped) return;
    const now = Date.now();
    timer = setTimeout(
      () => {
        void run();
        schedule();
      },
      60_000 - (now % 60_000) + 1000
    );
    timer.unref?.();
  };
  void run();
  schedule();
  g.__agentosScheduler = {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      g.__agentosScheduler = undefined;
    },
  };
  return g.__agentosScheduler;
}
