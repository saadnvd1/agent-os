// Handing a task to Saad: one ask on his list (one per task, however often
// it escalates), one escalation note in the orchestrator's chat, and the
// task held so the orchestrator doesn't merge it.

import { AskRefused, raiseAsk, workSubject } from "./asks";
import {
  failureOf,
  markEscalated,
  recordFailure,
  type GateOutcome,
} from "./gates";
import { addNote } from "./notes";

export function escalate(
  workspaceId: string,
  task: { id: string; name: string },
  gate: string,
  why: string,
  url: string,
  sha: string | null = null
): string {
  if (!failureOf(task.id, gate))
    recordFailure(workspaceId, task.id, gate, why, sha);
  markEscalated(task.id, gate);
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
  return `Escalated to Saad: ${why}. It's on his asks list; his answer reaches you as an event. Don't retry; say so in your chat.`;
}

// Counts a gate's failure on this head against the task; the same gate
// failing on a second, different head goes to Saad. The same head judged
// again, from any path, isn't another failure.
export function countFailure(
  workspaceId: string,
  task: { id: string; name: string },
  o: GateOutcome,
  url: string,
  sha: string
): { line: string; escalated: boolean } {
  const n = recordFailure(workspaceId, task.id, o.gate, o.reason ?? "", sha);
  const line = `- ${o.gate} failed (${n === 1 ? "first" : "again"}): ${o.reason}`;
  if (n < 2 || failureOf(task.id, o.gate)?.escalated_at)
    return { line, escalated: false };
  const why = `the ${o.gate} gate failed on two different commits: ${o.reason}`;
  return {
    line: `${line}\n  ${escalate(workspaceId, task, o.gate, why, url, sha)}`,
    escalated: true,
  };
}
