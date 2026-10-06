/**
 * Pause: while it's set the orchestrator acts on nothing. Its events queue
 * (the watcher keeps diffing but delivers nothing), its acting tools refuse,
 * and starts and merges it set going (stack cards, a land) hold. Saad can
 * still talk to it, and it can still read, note and ask. Resume delivers
 * what queued, folded.
 */

import { db } from "../db";
import { getWorkspace } from "../workspaces";
import { addNote } from "./notes";

export function isPaused(workspaceId: string): boolean {
  return !!getWorkspace(workspaceId)?.orch_paused_at;
}

export const PAUSED_REFUSAL =
  "Paused by Saad: acting tools refuse until he resumes. You can still read, note and ask_saad; events wait until then.";

export function setPaused(workspaceId: string, paused: boolean): boolean {
  const changed = db
    .prepare(
      paused
        ? `UPDATE workspaces SET orch_paused_at = datetime('now') WHERE id = ? AND orch_paused_at IS NULL`
        : `UPDATE workspaces SET orch_paused_at = NULL WHERE id = ? AND orch_paused_at IS NOT NULL`
    )
    .run(workspaceId).changes;
  if (changed)
    addNote(
      workspaceId,
      paused
        ? "Paused by Saad. Events wait and acting tools refuse until he resumes."
        : "Resumed by Saad. Events that queued while paused are delivered now.",
      "pause"
    );
  return changed === 1;
}
