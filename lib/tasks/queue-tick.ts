/**
 * The loop that wires the queue: one look at the line scores every queued
 * task and every paused task that came due, places the starts this machine's
 * load rules out, plans who starts, writes why the rest wait (from the
 * holds), and starts what fits. One look at a time.
 */

import { db } from "../db";
import { localView } from "../load/machines";
import { claimResume, dueResumes, setPauseNote } from "./pause";
import { unplaceable } from "./placement";
import { planStarts, type Candidate } from "./schedule";
import { placeable, queueNote, resumeNote, type Hold } from "./holds";
import {
  buildGroups,
  candidateOf,
  forceDueResumes,
  resumeCandidate,
} from "./queue-candidates";
import { placeCandidates } from "./queue-placement";
import { patch, row, slotState, usedFinishes } from "./queue-rows";
import { startRow } from "./queue-start";
import type { QueueRow, QueueRowWithWorkspace } from "./queue-types";

const g = globalThis as unknown as {
  __agentosQueueTick?: { ticking: Promise<void> | null };
};

// One look at the line: every queued task and every paused task that came
// due, scored, held or started. Machine readings come from the monitor and
// the peer poll; the clock is passed in.
export async function tickOnce(now = Date.now()): Promise<"stale" | void> {
  const rows = db
    .prepare(
      `SELECT q.*, p.workspace_id AS workspace_id FROM task_queue q
       JOIN projects p ON p.id = q.project_id
       WHERE q.status IN ('queued', 'starting') ORDER BY q.position`
    )
    .all() as QueueRowWithWorkspace[];
  const due = dueResumes();
  await forceDueResumes(due);
  const resumes = due.filter((x) => !x.resumeBy);
  if (!rows.length && !resumes.length) return;
  const queued = rows.filter((r) => r.status === "queued");
  const used = usedFinishes();
  const built = new Map(
    queued.map((r) => [r.id, candidateOf(r, used)] as const)
  );
  const candidates: Candidate[] = [...built.values()].map((b) => b.c);
  for (const d of resumes) candidates.push(resumeCandidate(d));

  // A start the home machine's load rules out goes to a free linked
  // machine, best score first, one per machine per look.
  const home = localView(now);
  const placements = await placeCandidates(
    candidates,
    rows,
    new Map([...built].map(([id, b]) => [id, b.needs])),
    home,
    now
  );
  if (placements === "stale") return "stale";

  const plan = planStarts(
    candidates,
    buildGroups(candidates, rows, resumes),
    home,
    now
  );
  for (const r of queued) writeQueueNote(r, stayHeld(r, plan.holds.get(r.id)));
  for (const d of resumes)
    setPauseNote(
      d.sessionId,
      resumeNote(
        plan.holds.get(`resume:${d.sessionId}`),
        slotState(d.projectId)
      )
    );

  for (const id of plan.start) {
    if (id.startsWith("resume:")) {
      await claimResume(id.slice("resume:".length), { reason: "due" });
      continue;
    }
    const r = row(id);
    if (r?.status === "queued")
      await startRow(r, {
        consume: plan.consume.get(id) ?? null,
        placement: placements.get(id) ?? null,
        heavy: built.get(id)?.c.heavy,
      });
  }
}

// A hold on this machine's load says, for a task that can't go elsewhere,
// why it waits here instead of starting on a linked machine.
function stayHeld(r: QueueRow, holds: Hold[] | undefined): Hold[] | undefined {
  const head = holds?.[0];
  const why = unplaceable(r);
  if (!holds || !head || !why || !placeable(head) || !("machine" in head))
    return holds;
  return [{ ...head, stay: why }, ...holds.slice(1)];
}

// Writes why a row waits when that changed: its first hold's text and code.
// A bare rank isn't stored (the view computes it), so the stream stays quiet.
function writeQueueNote(r: QueueRow, holds: Hold[] | undefined): void {
  const explain = queueNote(holds);
  if (!explain) return;
  const hold = explain.code && explain.code !== "slot" ? explain : null;
  if (hold) {
    if (r.note !== hold.text || r.wait_code !== hold.code)
      patch(r.id, { note: hold.text, wait_code: hold.code });
    return;
  }
  // A hold we wrote before is cleared; a brake's note isn't ours to clear.
  if (r.wait_code && r.wait_code !== "slot")
    patch(r.id, { note: null, wait_code: explain.code });
  else if (r.wait_code !== explain.code)
    patch(r.id, { wait_code: explain.code });
}

// One look at a time; a call during one shares it, and a look that went
// stale (the line changed while it waited on a machine) is run again.
const tickState = (g.__agentosQueueTick ??= { ticking: null });

export function tickQueue(): Promise<void> {
  tickState.ticking ??= (async () => {
    try {
      // Plans written on a linked machine, and approved plans coming here.
      await import("./remote-plan")
        .then((m) => m.syncRemotePlans())
        .catch((error: unknown) => console.error("[queue] plans:", error));
      for (let i = 0; i < 3; i++) {
        if ((await tickOnce()) !== "stale") break;
      }
    } finally {
      tickState.ticking = null;
    }
  })();
  return tickState.ticking;
}

export function tickQueueSoon(): void {
  void tickQueue().catch((error: unknown) =>
    console.error("[queue] tick:", error)
  );
}
