import type { Session } from "../db";
import { stopChat } from "../chat/runner";
import { waitForExit } from "../chat/worker/client";
import { endTmuxSession } from "../tmux/end";
import { releaseOnEnd, shutTaskSimulators } from "../simulator";
import { forgetPlanWait } from "../models/plan-step";
import { kickWaits } from "../bus/waits/kick";
import { openChildren } from "../fork/ledger";
import { cancelChildren } from "../fork/settle";

type Agent = Pick<Session, "id" | "host_id" | "tmux_name"> &
  Partial<Pick<Session, "worktree_path" | "branch_name">>;

// A session's agent, ended: its chat worker, and its own tmux session (a
// chat session can still own one). The one call that delete, done, drop and
// finish share.
export async function endSessionAgent(s: Agent): Promise<void> {
  forgetPlanWait(s.id);
  // Its forks have no one to report to.
  if (openChildren(s.id).length)
    void cancelChildren(s.id).catch(() => undefined);
  stopChat(s.id);
  // The task's simulator goes with it; no row, no work.
  releaseOnEnd(s.id, { remove: true });
  // And any the project's own scripts booted for it; shut down only.
  shutTaskSimulators(s);
  void waitForExit(s.id).catch(() => {});
  await endTmuxSession(s.host_id, s.tmux_name);
  // Whoever waits on it is told now, not at the next sweep.
  kickWaits();
}
