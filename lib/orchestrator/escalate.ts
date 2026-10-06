// Handing a task to Saad: one ask on his list (one per task, however often
// it escalates), one escalation note in the orchestrator's chat, and the
// task held so the orchestrator doesn't merge it.

import type { Session } from "../db";
import { raiseAsk, taskSubject } from "./asks";
import { failureOf, markEscalated, recordFailure } from "./gates";
import { addNote } from "./notes";

export function escalate(
  workspaceId: string,
  task: Session,
  gate: string,
  why: string,
  url: string,
  sha: string | null = null
): string {
  if (!failureOf(task.id, gate)) recordFailure(workspaceId, task.id, gate, why);
  markEscalated(task.id, gate);
  const { created } = raiseAsk({
    workspaceId,
    subject: taskSubject(task.id),
    kind: "gate",
    title: `Merge ${task.name}?`,
    detail: why,
    link: url,
    sha,
  });
  if (created)
    addNote(
      workspaceId,
      `Saad must decide on ${task.name} (${url}): ${why}. The orchestrator won't merge it; it's on his asks list to approve, decline, or sign off or drop himself.`,
      "escalation"
    );
  return `Escalated to Saad: ${why}. It's on his asks list; his answer reaches you as an event. Don't retry; say so in your chat.`;
}
