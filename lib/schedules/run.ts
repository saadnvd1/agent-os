import { randomUUID } from "crypto";
import { isPaused } from "../orchestrator/pause";
import {
  claimSlot,
  finishRun,
  lastStarted,
  type RunTrigger,
  type Schedule,
  type ScheduleRun,
} from "./store";

// How each kind starts its work, and whether a run is still going. Real
// ones in ./start; tests pass their own.
export interface RunDeps {
  start: (schedule: Schedule) => Promise<string>;
  stillRunning: (schedule: Schedule, run: ScheduleRun) => Promise<boolean>;
  notify: (schedule: Schedule, why: string) => void;
}

export interface RunResult {
  runId: number;
  outcome: "started" | "skipped" | "failed";
  detail: string | null;
  sessionId: string | null;
}

export const fromLabel = (s: Pick<Schedule, "name">) => `Schedule ${s.name}`;

export const slotKey = (slotAt: number) => new Date(slotAt).toISOString();

// Runs one slot of a schedule, or returns null when another tick already
// took it. The slot is claimed in SQLite before anything starts, so a slot
// runs once however many ticks see it. Run now (manual) gets a slot of its
// own and goes even while paused or while the last run is still working:
// Saad asked for it.
export async function runSlot(
  schedule: Schedule,
  slotAt: number,
  trigger: RunTrigger,
  deps: RunDeps
): Promise<RunResult | null> {
  const slot =
    trigger === "manual" ? `manual:${randomUUID()}` : slotKey(slotAt);
  const runId = claimSlot(schedule.id, slot, slotAt, trigger);
  if (runId === null) return null;
  const caughtUp = trigger === "catch-up" ? "caught up" : null;
  const done = (
    outcome: RunResult["outcome"],
    detail: string | null,
    sessionId: string | null = null
  ): RunResult => {
    finishRun(runId, outcome, detail, sessionId);
    return { runId, outcome, detail, sessionId };
  };
  const joined = (...parts: (string | null)[]) =>
    parts.filter(Boolean).join(": ") || null;

  if (trigger !== "manual") {
    if (isPaused(schedule.workspace_id))
      return done("skipped", joined(caughtUp, "paused with the orchestrator"));
    const previous = lastStarted(schedule.id, runId);
    if (previous) {
      let busy = false;
      try {
        busy = await deps.stillRunning(schedule, previous);
      } catch {
        // Can't tell: start rather than stall the schedule for good.
      }
      if (busy)
        return done(
          "skipped",
          joined(caughtUp, "still running"),
          previous.session_id
        );
    }
  }

  try {
    const sessionId = await deps.start(schedule);
    return done("started", caughtUp, sessionId);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    try {
      deps.notify(schedule, why);
    } catch (e) {
      console.error(`[schedules] couldn't notify about ${schedule.name}:`, e);
    }
    return done("failed", why);
  }
}
