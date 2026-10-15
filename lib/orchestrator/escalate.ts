// Handing a task to Saad: one ask on his list (one per task, however often
// it escalates), one escalation note in the orchestrator's chat, and the
// task held so the orchestrator doesn't merge it.

import { AskRefused, EXTERNAL_PREFIX, raiseAsk, workSubject } from "./asks";
import {
  failureOf,
  holdAsk,
  markEscalated,
  recordFailure,
  type GateOutcome,
} from "./gates";
import { LOOP_GUARD_COMMITS, stuckBy, stuckWhy } from "./loop-guard";
import { addNote } from "./notes";

// Puts the ask on Saad's list (or notes why it couldn't be).
export function askSaadAbout(
  workspaceId: string,
  task: { id: string; name: string },
  why: string,
  url: string,
  sha: string | null
): void {
  let created = false;
  try {
    created = raiseAsk({
      workspaceId,
      subject: workSubject(task.id),
      kind: "gate",
      title: `Merge ${task.name}?`,
      detail: why,
      link: url,
      sha,
    }).created;
  } catch (error) {
    if (!(error instanceof AskRefused)) throw error;
    addNote(
      workspaceId,
      `Saad must decide on ${task.name} (${url}): ${why}. Not added to his asks: ${error.message}.`,
      "escalation"
    );
  }
  if (created)
    addNote(
      workspaceId,
      `Saad must decide on ${task.name} (${url}): ${why}. The orchestrator won't merge it; it's on his asks list to approve, decline, or sign off or drop himself.`,
      "escalation"
    );
}

// `hold`: the task is held at once, but Saad's ask waits until its agent is
// idle and CI has settled, so it names the commit he'd merge (held-asks.ts).
export function escalate(
  workspaceId: string,
  task: { id: string; name: string },
  gate: string,
  why: string,
  url: string,
  sha: string | null = null,
  opts: { hold?: boolean } = {}
): string {
  if (!failureOf(task.id, gate))
    recordFailure(workspaceId, task.id, gate, why, sha);
  markEscalated(task.id, gate, why);
  if (opts.hold) {
    holdAsk(task.id, gate);
    return `Escalated to Saad: ${why}. His ask goes up once ${task.name}'s agent is idle and CI has settled on its latest head, so it names the commit he'd merge; his answer reaches you as an event. Don't retry; say so in your chat.`;
  }
  askSaadAbout(workspaceId, task, why, url, sha);
  return `Escalated to Saad: ${why}. It's on his asks list; his answer reaches you as an event. Don't retry; say so in your chat.`;
}

// Counts a gate's failure on this head against the task. A failure is the
// task's to fix, head after head; only a loop goes to Saad (loop-guard.ts):
// a task's ask held until its agent is done, a PR no task owns has no agent
// to wait for. The same head judged again, from any path, isn't another
// failure.
export function countFailure(
  workspaceId: string,
  task: { id: string; name: string },
  o: GateOutcome,
  url: string,
  sha: string,
  opts: { hold?: boolean; signature?: string | null } = {}
): { line: string; escalated: boolean } {
  recordFailure(
    workspaceId,
    task.id,
    o.gate,
    o.reason ?? "",
    sha,
    opts.signature ?? null
  );
  const row = failureOf(task.id, o.gate)!;
  const nth =
    row.streak <= 1
      ? "first"
      : `again, ${row.streak} of ${LOOP_GUARD_COMMITS} in a row`;
  const line = `- ${o.gate} failed (${nth}): ${o.reason}`;
  const by = row.escalated_at ? null : stuckBy(row);
  if (!by) return { line, escalated: false };
  const why = stuckWhy(task.id, row, by);
  return {
    line: `${line}\n  ${escalate(workspaceId, task, o.gate, why, url, sha, { hold: opts.hold ?? !task.id.startsWith(EXTERNAL_PREFIX) })}`,
    escalated: true,
  };
}
