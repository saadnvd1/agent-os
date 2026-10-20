// What the orchestrator's start_task does about work claimed elsewhere: a
// strong overlap queues the start after that claim, any other overlap is a
// heads-up. A person's start never comes through here.

import { checkStart, overlapText } from "../claims/startCheck";
import { machineId } from "../claims/machine";
import { IN_FLIGHT, resolveAfter, sessionOf } from "../tasks/queue-rows";
import { queueEvent } from "./events";
import type { Overlap } from "../claims/types";

export interface ClaimWait {
  // The `after` to queue with: a local task's id, or "claim:<id>".
  after?: string;
  // The overlap that set it, for the event once the start is queued.
  strong: Overlap | null;
  headsUp: string;
}

const isLocalTask = (sessionId: string) => {
  const s = sessionOf(sessionId);
  return !!s?.task_status && IN_FLIGHT.includes(s.task_status);
};

// A local task is waited on as a task (the existing `after`); anything else
// as a claim.
function afterOf(o: Overlap, workspaceId: string): string | undefined {
  const c = o.b;
  if (c.origin !== machineId() || !c.sessionId) return `claim:${c.id}`;
  if (!isLocalTask(c.sessionId)) return `claim:${c.id}`;
  try {
    return resolveAfter(c.sessionId, workspaceId).id;
  } catch {
    return undefined;
  }
}

export async function claimWait(
  start: { projectId: string; name?: string; prompt: string; base?: string },
  opts: { workspaceId: string; queue: boolean }
): Promise<ClaimWait> {
  const check = await checkStart(start);
  if (!check.overlaps.length) return { strong: null, headsUp: "" };
  const strong =
    (opts.queue && check.overlaps.find((o) => o.strength === "strong")) || null;
  const after = strong ? afterOf(strong, opts.workspaceId) : undefined;
  const lines = check.overlaps
    .slice(0, 3)
    .map((o) => `- ${o.strength}: ${overlapText(o)}`);
  return {
    after,
    strong: after ? strong : null,
    headsUp: `\nHeads-up, work already claimed:\n${lines.join("\n")}`,
  };
}

// Tells the orchestrator it was queued behind a claim, and how to override.
export function claimQueuedEvent(
  workspaceId: string,
  queued: { id: string; name: string },
  o: Overlap
): void {
  const shared = o.shared.length
    ? ` (shared: ${o.shared.slice(0, 5).join(", ")})`
    : "";
  queueEvent(
    workspaceId,
    `claim-queued:${queued.id}`,
    queued.id,
    `Queued "${queued.name}" (id ${queued.id.slice(0, 8)}) after ${overlapText(o)}${shared}. It starts when that work ends; start_now overrides, or drop it.`
  );
}
