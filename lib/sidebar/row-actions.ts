import type { Session } from "@/lib/db/types";

// What a row's ⋯ menu offers to finish it: Done (merge through the gates,
// stop, leave it on the Done shelf) for a task, Archive (put it away) for
// every session but an orchestrator. A plain session is finished with Mark
// done, so it only gets Archive here.
export type FinishAction = "done" | "archive";

export function finishActions(
  session: Pick<Session, "role" | "task_status">,
  plain: boolean
): FinishAction[] {
  if (session.role === "orchestrator") return [];
  return plain ? ["archive"] : ["done", "archive"];
}
