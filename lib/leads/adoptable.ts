import type { Session } from "@/lib/db/types";
import { isStandingRole } from "./roles";

export type Adoptee = Pick<
  Session,
  | "role"
  | "view"
  | "agent_type"
  | "task_status"
  | "worktree_path"
  | "archived_at"
  | "host_id"
>;

// Client-safe. Why this session can't become a lead of any kind, or null.
// The row menu offers "Adopt as lead" only where the server would take it.
export function adoptRefusal(s: Adoptee): string | null {
  if (isStandingRole(s.role)) return "That session already heads something";
  if (s.view !== "chat" || s.agent_type !== "claude")
    return "Only a Claude chat session can be adopted as a lead";
  if (s.task_status || s.worktree_path)
    return "A task's session can't be a lead";
  if (s.archived_at) return "Unarchive the session first";
  if (s.host_id && s.host_id !== "local")
    return "Only a session on this machine can be adopted";
  return null;
}
