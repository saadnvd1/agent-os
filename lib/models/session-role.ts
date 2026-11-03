import { orchestratorOf } from "../tasks/starter";
import type { ModelRole } from "./roles";

// Server-only: it reads the database, so the client-safe roles module can't hold it.
// The role a session's next turn runs as.
export function sessionRole(session: {
  role?: string | null;
  task_status?: string | null;
  plan_phase?: string | null;
  started_by?: string | null;
}): ModelRole {
  if (session.role === "orchestrator") return "orchestrator";
  // Work an orchestrator started is implementation, not a person's session.
  if (!session.task_status)
    return orchestratorOf(session.started_by) ? "implement" : "interactive";
  return session.plan_phase === "planning" || session.plan_phase === "awaiting"
    ? "plan"
    : "implement";
}
