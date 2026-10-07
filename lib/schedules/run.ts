import { randomUUID } from "crypto";
import {
  attachSession,
  claimSlot,
  finishRun,
  lastRunBefore,
  lastStarted,
  pausedFor,
  targetProblem,
  type RunTrigger,
  type Schedule,
  type ScheduleRun,
} from "./store";

// How each kind starts its work, and whether a run is still going. Real
// ones in ./start; tests pass their own. `start` calls onSession as soon as
// the session it starts exists, before anything slow, so a restart mid-start
// still knows what the run started.
export interface RunDeps {
  start: (
    schedule: Schedule,
    onSession: (sessionId: string) => void
  ) => Promise<string>;
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
// runs once however many ticks see it. Pause holds every run, Run now
// included. Run now (manual) gets a slot of its own and goes while the last
// run is still working; a scheduled run skips then, and skips too when it
// can't tell.
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
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const fail = (why: string): RunResult => {
    // Once per cause: a minutely schedule that keeps failing the same way
    // notifies the first time, not every minute.
    if (lastRunBefore(schedule.id, runId)?.detail !== why) {
      try {
        deps.notify(schedule, why);
      } catch (e) {
        console.error(`[schedules] couldn't notify about ${schedule.name}:`, e);
      }
    }
    return done("failed", why);
  };

  const target = targetProblem(schedule);
  if (target) return fail(target);
  if (pausedFor(schedule))
    return done("skipped", joined(caughtUp, "paused with the orchestrator"));
  if (trigger !== "manual") {
    const previous = lastStarted(schedule.id, runId);
    if (previous) {
      let busy: boolean;
      try {
        busy = await deps.stillRunning(schedule, previous);
      } catch (error) {
        return done(
          "skipped",
          joined(caughtUp, `couldn't check the last run: ${message(error)}`),
          previous.session_id
        );
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
    const sessionId = await deps.start(schedule, (id) =>
      attachSession(runId, id)
    );
    return done("started", caughtUp, sessionId);
  } catch (error) {
    return fail(message(error));
  }
}
