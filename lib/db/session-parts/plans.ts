import type Database from "better-sqlite3";
import type { PartPatch } from "./columns";
import { writePart, type When } from "./write";

// A task's plan step: phase, note, edits and the hand-off.
export const setPlan = (
  db: Database.Database,
  sessionId: string,
  patch: PartPatch<"session_plans">,
  when?: When<"session_plans">
): boolean => writePart(db, "session_plans", sessionId, patch, when);

// Moves a plan from one phase to the next, only while the task is running
// and still in `from` (a step another caller took first returns false).
export function advancePlan(
  db: Database.Database,
  sessionId: string,
  from: string,
  to: NonNullable<PartPatch<"session_plans">["plan_phase"]>
): boolean {
  return db.transaction(() => {
    const running = db
      .prepare(
        `SELECT 1 FROM session_rows WHERE id = ? AND task_status = 'running'`
      )
      .get(sessionId);
    return running
      ? setPlan(db, sessionId, { plan_phase: to }, { plan_phase: from })
      : false;
  })();
}
