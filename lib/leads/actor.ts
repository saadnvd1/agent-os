import { AsyncLocalStorage } from "async_hooks";
import type { Session } from "@/lib/db/types";

// The standing session whose tool call is running: what it sends, starts and
// notes is its own, not the orchestrator's. Outside a tool call (an event, a
// route, a timer) there is none, and everything stays the orchestrator's.
const acting = new AsyncLocalStorage<Session>();

export const asActor = <T>(session: Session, fn: () => T): T =>
  acting.run(session, fn);

// The caller in this workspace, if a standing session's call is running.
export function actorIn(workspaceId: string): Session | undefined {
  const s = acting.getStore();
  return s && s.workspace_id === workspaceId ? s : undefined;
}
