import type { Session } from "../../db";
import type { ChatStartOptions } from "../driver";

export type RoleExtras = Pick<
  ChatStartOptions,
  | "systemAppend"
  | "mcpServers"
  | "allowedTools"
  | "disallowedTools"
  | "permissionMode"
>;

// What a session's role adds to its chat. An orchestrator's module loads
// only for one; a task's chat gets its brief, as its terminal agent would.
export async function roleExtras(session: Session): Promise<RoleExtras> {
  if (session.role === "orchestrator")
    return (await import("../../orchestrator/worker")).orchestratorExtras(
      session
    );
  return session.task_brief ? { systemAppend: session.task_brief } : {};
}
