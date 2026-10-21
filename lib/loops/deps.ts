import { db, type Session } from "../db";
import { chatState } from "../chat/runner";
import { lastItems } from "../chat/store";
import { statusOf } from "../orchestrator/facts";
import { amendmentsOf } from "../orchestrator/amendments";
import { openBySubject, taskSubject, workSubject } from "../orchestrator/asks";
import { isPaused } from "../orchestrator/pause";
import { fetchRefs, repoOf } from "../orchestrator/repo";
import { readUsage, windowRefusal } from "../orchestrator/usage";
import { activePause } from "../tasks/pause";
import { analyse } from "./analyse";
import { diffMap } from "./diffMap";
import {
  commandsFromBase,
  gatherEvidence,
  testFilesFor,
} from "./gatherEvidence";
import { sendInstruction } from "./sendInstruction";
import { snapshotWorktree } from "./snapshot";
import { analystSpend, chatSpendSince } from "./store";
import type { LoopRow } from "./types";
import { git } from "../git-exec";

export interface Prepared {
  repo: string;
  base: string;
  dir: string;
}

export interface Hold {
  kind: "paused" | "usage-window";
  reason: string;
}

// Everything a cycle touches outside the database, so the tests can run a
// whole loop without a model, a shell or a chat.
export interface LoopDeps {
  now: () => number;
  task: (id: string) => Session | undefined;
  prepare: (task: Session) => Promise<Prepared>;
  snapshot: (dir: string) => Promise<{ sha: string; tree: string }>;
  commands: typeof commandsFromBase;
  testFiles: typeof testFilesFor;
  gather: typeof gatherEvidence;
  diff: typeof diffMap;
  analyse: typeof analyse;
  send: typeof sendInstruction;
  coderReply: (task: Session) => string | null;
  // Its agent is mid-turn right now.
  coderRunning: (task: Session) => Promise<boolean>;
  amendments: (taskId: string) => string[];
  spent: (loop: LoopRow) => number;
  hold: (loop: LoopRow, task: Session) => Hold | null;
  // Something only a person can clear: an open ask or question on the task.
  waitingOnPerson: (task: Session) => string | null;
}

export const taskRow = (id: string): Session | undefined =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;

// What the coder said at the end of its last turn.
export function lastReply(task: Session): string | null {
  if (task.view !== "chat") return null;
  const items = lastItems(task.id, 60);
  const start = items.findLastIndex((i) => i.kind === "user");
  const said = items
    .slice(start + 1)
    .filter(
      (i): i is Extract<typeof i, { kind: "assistant" }> =>
        i.kind === "assistant"
    );
  return said.length ? said.map((i) => i.text).join("\n\n") : null;
}

export const defaultDeps: LoopDeps = {
  now: Date.now,
  task: taskRow,
  prepare: async (task) => {
    if (!task.worktree_path) throw new Error("The task has no worktree");
    const repo = repoOf(task);
    return { repo, base: await fetchRefs(repo, task), dir: task.worktree_path };
  },
  snapshot: async (dir) => {
    const sha = await snapshotWorktree(dir);
    return {
      sha,
      tree: (await git(dir, ["rev-parse", `${sha}^{tree}`])).trim(),
    };
  },
  commands: commandsFromBase,
  testFiles: testFilesFor,
  gather: gatherEvidence,
  diff: diffMap,
  analyse,
  send: sendInstruction,
  coderReply: lastReply,
  coderRunning: async (task) =>
    task.view === "chat"
      ? chatState(task.id) === "running"
      : (await statusOf(task)).status === "running",
  amendments: (id) => amendmentsOf(id).map((a) => a.text),
  spent: (loop) =>
    chatSpendSince(loop.sessionId, loop.startedAt) + analystSpend(loop.id),
  hold: (loop, task) => {
    if (loop.workspaceId && isPaused(loop.workspaceId))
      return { kind: "paused", reason: "the workspace is paused" };
    if (activePause(task.id))
      return { kind: "paused", reason: "the task is paused" };
    const why = windowRefusal(readUsage());
    return why ? { kind: "usage-window", reason: why } : null;
  },
  waitingOnPerson: (task) => {
    const ws = task.workspace_id;
    if (
      ws &&
      (openBySubject(ws, workSubject(task.id)) ||
        openBySubject(ws, taskSubject(task.id)))
    )
      return "an open ask on the task is waiting for you";
    const q = db
      .prepare(
        `SELECT 1 FROM orchestrator_questions WHERE status = 'open' AND task = ?`
      )
      .get(task.id);
    return q ? "the task has an open question for you" : null;
  },
};
