import { criteriaOf, cycleCount, latestLoopFor, liveLoopFor } from "./store";
import type { LoopSummary } from "./types";

export function loopSummary(taskId: string): LoopSummary | null {
  const loop = latestLoopFor(taskId);
  if (!loop) return null;
  const criteria = criteriaOf(loop.id);
  return {
    state: loop.state,
    stopReason: loop.stopReason,
    cycle: cycleCount(loop.id),
    maxCycles: loop.maxCycles,
    met: criteria.filter((c) => c.status === "met" || c.status === "waived")
      .length,
    total: criteria.length,
    hold: null,
  };
}

// A line for the orchestrator's digest: only for a running loop.
export function loopDigestNote(taskId: string): string {
  if (!liveLoopFor(taskId)) return "";
  const s = loopSummary(taskId);
  return s
    ? ` | loop: cycle ${s.cycle}/${s.maxCycles}, ${s.met}/${s.total} criteria met`
    : "";
}
