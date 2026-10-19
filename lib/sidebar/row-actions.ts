import type { Session } from "@/lib/db/types";
import { isOverTask, isRestorableTask } from "@/lib/tasks/restorable";
import type { TaskState } from "@/lib/tasks/state";

// What a row's ⋯ menu offers to finish it: Done (merge through the gates,
// stop, leave it on the Done shelf) for a live task, Archive (put it away)
// for every session but an orchestrator. A plain session is finished with
// Mark done, so it only gets Archive here. A task that has ended is never
// finished again: a dropped or done one is restored (exactly what
// resurrectSession accepts), a merged or moved one only archived.
export type FinishAction = "done" | "restore" | "archive";

export function finishActions(
  session: Pick<Session, "role" | "task_status">,
  plain: boolean,
  derived?: TaskState
): FinishAction[] {
  if (session.role === "orchestrator") return [];
  if (plain) return ["archive"];
  if (isRestorableTask(session.task_status)) return ["restore", "archive"];
  // The PR can merge before the status catches up.
  if (
    isOverTask(session.task_status) ||
    derived === "merged" ||
    derived === "dropped" ||
    derived === "done"
  )
    return ["archive"];
  return ["done", "archive"];
}
