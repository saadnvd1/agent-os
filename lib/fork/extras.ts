/** What a chat worker adds for fork parents and children. */

import os from "os";
import type { Session } from "../db";
import type { ToolGuard } from "../chat/driver";
import { CHILD_BRIEF, PARENT_BRIEF } from "./brief";
import { forkToolGuard } from "./guard";
import { getChild } from "./ledger";
import { forksOn } from "./options";
import { scratchOf, worktreeOf } from "./scratch";
import { db } from "../db";

const expand = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

// The brief a session gets last (after everything it shares with its
// parent, so their prompts match as far as they can).
export function forkBrief(session: Session): string | null {
  if (getChild(session.id)) return CHILD_BRIEF;
  if (!forksOn() || session.role === "orchestrator" || session.view !== "chat")
    return null;
  return PARENT_BRIEF;
}

// A child's environment and guard: its scratch folder, who it is, and the
// checks that keep it off its parent's checkout. Only the Claude driver
// runs a guard; other agents' children work in a checkout of their own.
export function childExtras(
  session: Session
): { env: Record<string, string>; toolGuard?: ToolGuard } | null {
  const child = getChild(session.id);
  if (!child) return null;
  const parent = db
    .prepare(`SELECT working_directory FROM sessions WHERE id = ?`)
    .get(child.parent_session_id) as { working_directory: string } | undefined;
  const scratch = scratchOf(session.id);
  const env = {
    AOS_FORK_CHILD: "1",
    AOS_SCRATCH: scratch,
    AOS_FORK_PARENT: child.parent_session_id,
  };
  if (session.agent_type !== "claude") return { env };
  return {
    env,
    toolGuard: forkToolGuard({
      parentCheckout: expand(
        parent?.working_directory ?? session.working_directory
      ),
      scratch,
      ownCheckout: child.worktree ? worktreeOf(session.id) : null,
      cwd: expand(session.working_directory),
    }),
  };
}
