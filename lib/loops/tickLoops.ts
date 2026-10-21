import type { SessionFacts } from "../orchestrator/facts";
import { limitStop } from "./decideStop";
import { defaultDeps, type LoopDeps } from "./deps";
import {
  cycleInFlight,
  deliverCycle,
  processCycle,
  RETRY_MS,
  startCycle,
} from "./runCycle";
import {
  cycleCount,
  cyclesOf,
  moveCycle,
  runningLoops,
  setRunNow,
} from "./store";
import { finishLoop } from "./stopLoop";
import type { CycleTrigger, LoopRow } from "./types";

// The coder has to be quiet this long before a cycle starts, so a burst of
// turn ends is one cycle.
export const DEBOUNCE_MS = 20_000;
// After an instruction, a coder that never starts a turn is looked at again.
export const NO_START_MS = 3 * 60_000;

// Loops that have seen their coder run since the last instruction.
const sawRunning = new Set<string>();

export const resetLoopMemory = () => sawRunning.clear();

function trigger(
  loop: LoopRow,
  fact: SessionFacts,
  last: ReturnType<typeof cyclesOf>[number] | undefined,
  now: number
): CycleTrigger | null {
  const idle = fact.status !== "running";
  if (fact.status === "running") sawRunning.add(loop.id);
  if (loop.runNow && idle) return "manual";
  if (!idle) return null;
  const quiet = now - fact.lastActive >= DEBOUNCE_MS;
  if (!last) return quiet ? "turn_end" : null;
  if (last.state === "error")
    return now - (last.endedAt ?? last.startedAt) >= RETRY_MS
      ? "turn_end"
      : null;
  if (!["sent", "skipped", "superseded"].includes(last.state)) return null;
  const waited = now - (last.endedAt ?? now);
  if (quiet && (sawRunning.has(loop.id) || waited >= NO_START_MS))
    return "turn_end";
  const pr = fact.task?.pr;
  const seen = last.evidence?.ci[0]?.sha ?? null;
  if (
    quiet &&
    pr?.head &&
    pr.head !== seen &&
    (pr.checks === "pass" || pr.checks === "fail")
  )
    return "ci";
  return null;
}

// One pass over a workspace's running loops, from the watcher's pipeline:
// resumes a cycle a restart left, sends what's due, stops on a limit, or
// opens the next cycle when its coder's turn has ended.
export async function tickLoops(
  workspaceId: string,
  facts: SessionFacts[],
  deps: LoopDeps = defaultDeps
): Promise<void> {
  for (const loop of runningLoops(workspaceId)) {
    try {
      await tickLoop(loop, facts, deps);
    } catch (error) {
      console.error(`Loop ${loop.id}:`, error);
    }
  }
}

async function tickLoop(
  loop: LoopRow,
  facts: SessionFacts[],
  deps: LoopDeps
): Promise<void> {
  const now = deps.now();
  const task = deps.task(loop.sessionId);
  if (!task || task.archived_at || task.task_status !== "running") {
    finishLoop(
      loop,
      { reason: "stopped", detail: "the task finished or moved" },
      { taskName: task?.name ?? "the task", now }
    );
    return;
  }
  if (cycleInFlight(loop.id)) return;
  const hold = deps.hold(loop, task);
  if (hold) return;
  const fact = facts.find((f) => f.id === loop.sessionId);
  const ctx = { loop, task, facts: fact, deps };
  const last = cyclesOf(loop.id, { limit: 1 })[0];

  if (last?.state === "claimed") {
    await processCycle(ctx, last);
    return;
  }
  if (last?.state === "counting") {
    if (last.sendAt !== null && last.sendAt <= now) {
      if (await deps.coderRunning(task))
        moveCycle(loop.id, last.n, ["counting"], {
          state: "superseded",
          endedAt: now,
        });
      else await deliverCycle(ctx, last.n);
    }
    return;
  }
  if (last?.state === "sending") {
    // A restart between claiming the send and finishing it: the message
    // goes by a fixed id, so sending again is safe.
    moveCycle(loop.id, last.n, ["sending"], { state: "counting", sendAt: now });
    return;
  }
  const limit = limitStop({
    limits: loop,
    startedAt: loop.startedAt,
    spentUsd: deps.spent(loop),
    now,
    cycleCount: cycleCount(loop.id),
  });
  if (limit) {
    finishLoop(loop, limit, { taskName: task.name, now });
    return;
  }
  if (!fact) return;
  const why = trigger(loop, fact, last, now);
  if (!why) return;
  sawRunning.delete(loop.id);
  if (loop.runNow) setRunNow(loop.id, false);
  await startCycle(loop.id, why, fact, deps);
}
