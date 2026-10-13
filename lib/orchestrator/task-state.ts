// What a task is waiting on, and how long its CI has been settled: the
// live inputs to the blocked and ci gates.

import type { Session } from "../db";
import type { TaskPR } from "../tasks/state";
import { chatStateNow } from "../chat/runner";
import { saidSinceLastMessage } from "../chat/store";
import { blockedReason } from "../tasks/state";
import { checkWaitingPatterns, statusDetector } from "../status-detector";
import { getCheck, putCheck } from "./checks";
import { cleanRemoteText, hostLink, type HostLink } from "../hosts/remote-api";
import { heldChatFacts } from "../tasks/held-remote";
import { hostTasks } from "../tasks/remote";
import { peerPane } from "../hosts/peer-sessions";
import { untrusted } from "./untrusted";

// A BLOCKED: line or a waiting prompt, from wherever the task's agent
// writes. A task whose output can't be read can't be cleared.
export async function waitingState(
  task: Session
): Promise<{ blocked: string | null; waitingOn: string | null }> {
  // A quick change has no agent to block or ask: the orchestrator makes it.
  if (task.quick_of) return { blocked: null, waitingOn: null };
  // A linked machine's chat lives in that machine's store, not this one's:
  // its own reading of the task is asked for, fresh.
  const link = hostLink(task.host_id);
  if (link && task.view === "chat") return peerChatWaiting(link, task);
  if (task.view === "chat") return localChatWaiting(task);
  // A linked machine reads its own screens: asked, and an answer it can't
  // give is a screen that can't be cleared.
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

// A chat task whose conversation is in this machine's store (or, for a held
// task, the one the holder asks about).
export async function localChatWaiting(
  task: Pick<Session, "id" | "name">
): Promise<{ blocked: string | null; waitingOn: string | null }> {
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

async function peerChatWaiting(
  link: HostLink,
  task: Session
): Promise<{ blocked: string | null; waitingOn: string | null }> {
  const unread = {
    blocked: `its chat on ${link.hostName} couldn't be read, so a BLOCKED: line or open question can't be ruled out`,
    waitingOn: null,
  };
  // A task its orchestrator moved is asked about directly: the whole task
  // list is slow, and a miss there reads as unread.
  const facts = task.started_by ? await heldChatFacts(task) : null;
  if (facts) {
    const { turn } = facts;
    return {
      blocked: facts.blocked ? untrusted(task.name, facts.blocked) : null,
      waitingOn:
        turn === "waiting"
          ? `an approval or question in its chat on ${link.hostName}`
          : turn === null ||
              turn === "running" ||
              turn === "idle" ||
              turn === "error"
            ? null
            : `its chat on ${link.hostName} couldn't say whether a question is open`,
    };
  }
  const view = await hostTasks(link, true)
    .then(({ tasks, capabilities }) =>
      // One that can't say its chat's turn can't rule out an open question.
      Array.isArray(capabilities) && capabilities.includes("chat-turn")
        ? (Array.isArray(tasks) ? tasks : []).find((t) => t?.id === task.id)
        : undefined
    )
    .catch(() => undefined);
  if (!view || typeof view.state !== "string") return unread;
  const turn = view.chatTurn;
  const said =
    typeof view.blocked === "string" ? cleanRemoteText(view.blocked) : "";
  return {
    blocked: said
      ? untrusted(task.name, said)
      : view.state === "blocked"
        ? `${link.hostName} reports it blocked`
        : null,
    waitingOn:
      turn === "waiting"
        ? `an approval or question in its chat on ${link.hostName}`
        : // null: no worker running, so nothing open.
          turn === null ||
            turn === "running" ||
            turn === "idle" ||
            turn === "error"
          ? null
          : `its chat on ${link.hostName} couldn't say whether a question is open`,
  };
}

// CI counts as settled once the head commit is 2 minutes old and no new
// check has registered on it for 2 minutes. Seconds still to wait.
export const SETTLE_S = 120;

// When the check count last changed, as ciSettleIn stored it.
const lastSeen = (detail: string | null | undefined) =>
  detail ? (JSON.parse(detail) as { count: number; at: number }) : null;

const settleLeft = (
  last: { count: number; at: number } | null,
  checkCount: number,
  committedAt: number,
  now: number
) => {
  const changedAt = last && last.count === checkCount ? last.at : now;
  return Math.max(0, Math.max(committedAt, changedAt) + SETTLE_S - now);
};

export function ciSettleIn(input: {
  workspaceId: string;
  taskId: string;
  sha: string;
  checkCount: number;
  committedAt: number;
  now?: number;
}): number {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const last = lastSeen(getCheck(input.taskId, input.sha, "ci")?.detail);
  if (!last || last.count !== input.checkCount)
    putCheck({
      workspaceId: input.workspaceId,
      sessionId: input.taskId,
      sha: input.sha,
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: input.checkCount, at: now }),
    });
  return settleLeft(last, input.checkCount, input.committedAt, now);
}

// The same answer from what ciSettleIn stored, writing nothing: for a
// status that only looks.
export function ciSettleLeft(input: {
  taskId: string;
  sha: string;
  checkCount: number;
  committedAt: number;
  now?: number;
}): number {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const last = lastSeen(getCheck(input.taskId, input.sha, "ci")?.detail);
  return settleLeft(last, input.checkCount, input.committedAt, now);
}

// A head with no checks for this long after its PR became mergeable, in a
// repository with CI, is news for the orchestrator (never an escalation).
export const CHECKLESS_MS = 30 * 60 * 1000;

const checkless = new Map<string, number>();

// How long this head has had no checks while its PR could merge cleanly, in
// ms, or undefined when it isn't in that state. In memory: a restart only
// restarts the clock.
export function checklessFor(
  taskId: string,
  pr: Pick<TaskPR, "state" | "checks" | "head" | "mergeable">,
  now = Date.now()
): number | undefined {
  const key = `${taskId}:${pr.head ?? ""}`;
  for (const k of checkless.keys())
    if (k.startsWith(`${taskId}:`) && k !== key) checkless.delete(k);
  if (
    pr.state !== "OPEN" ||
    pr.checks !== "none" ||
    pr.mergeable !== "MERGEABLE"
  ) {
    checkless.delete(key);
    return undefined;
  }
  const since = checkless.get(key) ?? now;
  checkless.set(key, since);
  return now - since;
}
