// Handing a task to Saad: one escalation note in the orchestrator's chat,
// and the task held so the orchestrator doesn't merge it.

import type { Session } from "../db";
import { failureOf, markEscalated, recordFailure } from "./gates";
import { addNote } from "./notes";

export function escalate(
  workspaceId: string,
  task: Session,
  gate: string,
  why: string,
  url: string
): string {
  if (!failureOf(task.id, gate)) recordFailure(workspaceId, task.id, gate, why);
  markEscalated(task.id, gate);
  addNote(
    workspaceId,
    `Saad must decide on ${task.name} (${url}): ${why}. The orchestrator won't merge it; sign it off or drop it yourself.`,
    "escalation"
  );
  return `Escalated to Saad: ${why}. Don't retry; say so in your chat.`;
}
