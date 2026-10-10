// What a task is waiting on, and how long its CI has been settled: the
// live inputs to the blocked and ci gates.

import type { Session } from "../db";
import { chatStateNow } from "../chat/runner";
import { saidSinceLastMessage } from "../chat/store";
import { blockedReason } from "../tasks/state";
import { checkWaitingPatterns, statusDetector } from "../status-detector";
import { getCheck, putCheck } from "./checks";
import { hostLink } from "../hosts/remote-api";
import { peerPane } from "../hosts/peer-sessions";
import { untrusted } from "./untrusted";

// A BLOCKED: line or a waiting prompt, from wherever the task's agent
// writes. A task whose output can't be read can't be cleared.
export async function waitingState(
  task: Session
): Promise<{ blocked: string | null; waitingOn: string | null }> {
  if (task.view === "chat") {
    const reason = blockedReason(saidSinceLastMessage(task.id));
    // Asked of a worker still running from before a restart, too; one
    // that can't be reached can't be cleared.
    const state = await chatStateNow(task.id).catch(() => "unknown");
    return {
      blocked: reason === null ? null : untrusted(task.name, reason),
      waitingOn:
        state === "waiting"
          ? "an approval or question in its chat"
          : state === "unknown"
            ? "its chat worker couldn't be reached, so an open approval or question can't be ruled out"
            : null,
    };
  }
  // A linked machine reads its own screens: asked, and an answer it can't
  // give is a screen that can't be cleared.
  const link = hostLink(task.host_id);
  let tail: string;
  if (link) {
    const lines = await peerPane(link, task.id);
    if (!lines)
      return {
        blocked: `its terminal on ${link.hostName} couldn't be read, so a BLOCKED: line or open prompt can't be ruled out`,
        waitingOn: null,
      };
    tail = lines.slice(-15).join("\n");
  } else {
    const host = task.host_id || "local";
    await statusDetector.refreshCache();
    if (!statusDetector.sessionExists(task.tmux_name, host))
      return {
        blocked:
          "its terminal is gone, so a BLOCKED: line or open prompt can't be ruled out",
        waitingOn: null,
      };
    tail = (await statusDetector.capturePane(task.tmux_name, host))
      .split("\n")
      .slice(-15)
      .join("\n");
  }
  const reason = blockedReason(tail);
  return {
    blocked: reason === null ? null : untrusted(task.name, reason),
    waitingOn: checkWaitingPatterns(tail) ? "a prompt in its terminal" : null,
  };
}

// CI counts as settled once the head commit is 2 minutes old and no new
// check has registered on it for 2 minutes. Seconds still to wait.
export const SETTLE_S = 120;

export function ciSettleIn(input: {
  workspaceId: string;
  taskId: string;
  sha: string;
  checkCount: number;
  committedAt: number;
  now?: number;
}): number {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const seen = getCheck(input.taskId, input.sha, "ci");
  const last = seen?.detail
    ? (JSON.parse(seen.detail) as { count: number; at: number })
    : null;
  const changedAt = last && last.count === input.checkCount ? last.at : now;
  if (!last || last.count !== input.checkCount)
    putCheck({
      workspaceId: input.workspaceId,
      sessionId: input.taskId,
      sha: input.sha,
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: input.checkCount, at: now }),
    });
  const settledAt = Math.max(input.committedAt, changedAt) + SETTLE_S;
  return Math.max(0, settledAt - now);
}
