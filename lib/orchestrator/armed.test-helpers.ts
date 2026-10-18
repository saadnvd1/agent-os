import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { beforeAll, beforeEach, vi } from "vitest";
import type { TaskPR } from "@/lib/tasks/state";
import type { SessionFacts } from "./facts";
import { tempDir } from "@/lib/test-temp";

// Shared fixtures for the armed*.test.ts files: a real repository with a
// local bare remote, gh faked around it. Import this before anything it mocks.
// Tests change the fake world through S.
export const S: { pr: TaskPR | null } = { pr: null };
export const merges: string[][] = [];
export const isProbe = (args: string[]) =>
  args[0] === "api" ||
  (args[0] === "pr" &&
    args[1] === "list" &&
    args.includes("statusCheckRollup"));

vi.mock("@/lib/tasks/gh", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tasks/gh")>();
  return {
    ...real,
    run: async (cmd: string, args: string[], cwd: string, t?: number) => {
      if (cmd === "gh" && isProbe(args)) return "0";
      if (cmd === "gh") {
        merges.push(args);
        if (S.pr) S.pr = { ...S.pr, state: "MERGED" };
        return "";
      }
      if (cmd === "tmux") throw new Error("no tmux in tests");
      return real.run(cmd, args, cwd, t);
    },
    findPR: async () => S.pr,
  };
});
vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => true,
    getStatus: async () => "idle",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => "❯ ",
  },
}));

export const { db, updateSessionRow } = await import("@/lib/db");
export const { createProject } = await import("@/lib/projects");
export const { createWorkspace, setProjectWorkspace } =
  await import("@/lib/workspaces");
export const { ensureOrchestrator } = await import("./home");
export const { runTool } = await import("./serve");
export const { getCheck, putCheck } = await import("./checks");
export const { failureOf, recordFailure } = await import("./gates");
export const { LOOP_GUARD_COMMITS } = await import("./loop-guard");
export const { seedSession } = await import("./testing");
export const { setMergeApprovals } = await import("./merge-approvals");
export const { mergeArmed, armTask } = await import("./armed");
export const { setPaused } = await import("./pause");
export const { escalate } = await import("./escalate");
export const { openAsks, raiseAsk } = await import("./asks");
export const { judge, mergeJudged } = await import("./signoff");
export const { rebaseConflicting } = await import("./rebase");
export const { recordConditions } = await import("./events");

beforeAll(() => {
  const home = tempDir("aos-orch-armed-");
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  merges.length = 0;
});

export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
  }).trim();

export function commit(repo: string, file: string, text: string): string {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", `change ${file}`);
  git(repo, "push", "-q", "origin", "HEAD");
  return git(repo, "rev-parse", "HEAD");
}

export const lines = (n: number, change: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => change[i + 1] ?? `line ${i + 1}`).join(
    "\n"
  ) + "\n";

// A workspace whose project is a real clone, which is also the task's
// worktree, on its branch with its PR open at the branch's head. `other`
// is a second clone for moving main.
export function setup() {
  setMergeApprovals(false);
  const root = tempDir("aos-armed-repo-");
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  const other = path.join(root, "other");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, repo);
  for (const r of [repo]) {
    git(r, "config", "user.email", "t@example.com");
    git(r, "config", "user.name", "T");
  }
  commit(repo, "src/b.ts", lines(12));
  git(root, "clone", "-q", remote, other);
  git(other, "config", "user.email", "o@example.com");
  git(other, "config", "user.name", "O");
  git(repo, "checkout", "-qb", "feature/t");
  const sha = commit(repo, "src/b.ts", lines(12, { 5: "changed five" }));

  const workspace = createWorkspace(`ws-${path.basename(root)}`);
  const project = createProject({
    name: `app-${path.basename(root)}`,
    workingDirectory: repo,
  });
  setProjectWorkspace(project.id, workspace.id);
  // These tests judge today's gates; fast-lane.test.ts flips it.
  db.prepare(`UPDATE projects SET tier = 'production' WHERE id = ?`).run(
    project.id
  );
  ensureOrchestrator(workspace.id);
  const task = seedSession({
    projectId: project.id,
    name: "add-a",
    task: true,
    branch: "feature/t",
  });
  updateSessionRow(db, task, {
    base_branch: "main",
    task_prompt: "Add a",
    pr_number: 7,
    worktree_path: repo,
  });
  S.pr = {
    number: 7,
    url: "https://github.com/o/r/pull/7",
    state: "OPEN",
    checks: "pass",
    head: sha,
    failing: null,
    checkCount: 1,
    attribution: null,
  };
  const w = workspace.id;
  const put = (
    kind: "review" | "ci",
    status: "pass" | "block",
    at = S.pr!.head!
  ) =>
    putCheck({
      workspaceId: w,
      sessionId: task,
      sha: at,
      kind,
      status,
      detail:
        kind === "ci"
          ? JSON.stringify({ count: S.pr!.checkCount, at: 0 })
          : "Looks right.",
    });
  // CI has looked settled on the head for a while.
  put("ci", "pass");
  return {
    w,
    repo,
    other,
    remote,
    task,
    sha,
    put,
    // Someone else's PR merged: main moves.
    moveMain: (file: string, text: string) => {
      git(other, "pull", "-q", "origin", "main");
      return commit(other, file, text);
    },
    facts: (status: SessionFacts["status"] = "idle"): SessionFacts[] => [
      {
        id: task,
        name: "add-a",
        project: project.name,
        view: "terminal",
        status,
        activity: null,
        needsInput: false,
        lastActive: 0,
        branch: "feature/t",
        task: { state: "review", pr: S.pr, blocked: null, ciSettleIn: 0 },
        stack: null,
      },
    ],
  };
}

export const events = (w: string) =>
  (
    db
      .prepare(
        `SELECT key, line FROM orchestrator_events WHERE workspace_id = ? AND key LIKE 'once:%' ORDER BY id`
      )
      .all(w) as { key: string; line: string }[]
  ).map((e) => e.line);

export const armedAt = (task: string) =>
  (
    db
      .prepare(`SELECT merge_armed_at FROM session_rows WHERE id = ?`)
      .get(task) as { merge_armed_at: string | null }
  ).merge_armed_at;

export function armedDeps() {
  const reviews: string[] = [];
  return {
    reviews,
    deps: {
      judge,
      merge: mergeJudged,
      review: async (_w: string, id: string) => {
        reviews.push(id);
      },
    },
  };
}
