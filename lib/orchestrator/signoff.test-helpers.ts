import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { beforeAll, beforeEach, expect, vi } from "vitest";
import type { TaskPR } from "@/lib/tasks/state";
import type { ClaudeRun } from "./claude-cli";
import type { SessionFacts } from "./facts";
import { tempDir } from "@/lib/test-temp";

// Shared fixtures for the signoff*.test.ts files: a real repository with a
// local bare remote, gh faked around it. Import this before anything it mocks.
// Tests change the fake world through S.
export const S: {
  pr: TaskPR | null;
  prError: Error | null;
  pane: string;
  refuseMerge: string | null;
  probeOut: string | Error;
  ciLog: string;
  commitDate: string | undefined;
} = {
  pr: null,
  prError: null,
  pane: "",
  refuseMerge: null,
  probeOut: "0",
  ciLog:
    "Test 1\tRun tests\t2026-01-01T00:00:00.0Z  FAIL  src/a.test.ts > adds\n",
  commitDate: "2026-01-01T00:00:00Z",
};
export const ATTRIBUTED = "a Co-Authored-By trailer naming Claude" as const;
export const merges: string[][] = [];
export const JOB_URL = "https://github.com/o/r/actions/runs/1/job/2";
// CI failing on the head, with a log the loop guard can read.
export const failingCI = (failing = "unit") =>
  ({ ...S.pr!, checks: "fail", failing, failingUrl: JOB_URL }) as TaskPR;
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
      if (cmd === "gh" && args[0] === "run" && args[1] === "view")
        return S.ciLog;
      if (cmd === "gh" && isProbe(args)) {
        if (S.probeOut instanceof Error) throw S.probeOut;
        return S.probeOut;
      }
      if (cmd === "gh") {
        if (S.refuseMerge) throw new Error(S.refuseMerge);
        merges.push(args);
        if (S.pr) S.pr = { ...S.pr, state: "MERGED" };
        return "";
      }
      if (cmd === "tmux") throw new Error("no tmux in tests");
      return real.run(cmd, args, cwd, t);
    },
    findPR: async () => S.pr,
    findPRStrict: async () => {
      if (S.prError) throw S.prError;
      return S.pr;
    },
  };
});
// The test clones have a local origin; the CI probes need a GitHub name.
vi.mock("./repo-slug", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repo-slug")>()),
  repoSlug: async () => "o/r",
}));
vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: (t: string) => /Allow\?/.test(t),
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => S.pane !== "",
    getStatus: async () => "idle",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => S.pane,
  },
}));

export const { db, stackQueries, updateSessionRow } = await import("@/lib/db");
export const { createProject } = await import("@/lib/projects");
export const { createWorkspace, setProjectWorkspace } =
  await import("@/lib/workspaces");
export const { ensureOrchestrator } = await import("./home");
export const { runTool } = await import("./serve");
export const { judge, landDeps, mergeJudged, refundIfRefused } =
  await import("./signoff");
export const { armTask, mergeArmed } = await import("./armed");
export const { resumeReviews, review } = await import("./review");
export const { getCheck, putCheck } = await import("./checks");
export const { failureOf, recordFailure } = await import("./gates");
export const { LOOP_GUARD_COMMITS } = await import("./loop-guard");
export const { clearRepoCI } = await import("./repo-ci");
export const { listNotes } = await import("./notes");
export const { listItems } = await import("@/lib/chat/store");
export const { claudeArgs } = await import("./claude-cli");
export const { seedSession } = await import("./testing");
export const { answerAsk, getAsk, openAsks, raiseAsk, BRAKE_SUBJECT } =
  await import("./asks");
export const { setMergeApprovals } = await import("./merge-approvals");
export const { releaseInterruptedClaims, spendApproval } =
  await import("./ask-approvals");
export const { amendBrief } = await import("./amendments");
export const { fetchRefs } = await import("./repo");
export const { getTaskSession } = await import("@/lib/tasks/session");
export const { changedFiles } = await import("./diff");
export const { followAskHeads } = await import("./ask-heads");
export const { followAskVerdicts } = await import("./ask-verdict");
export const { raiseHeldAsks, HOLD_MIN_MS, HOLD_MAX_MS } =
  await import("./held-asks");

// The one ask a task's escalation leaves on Saad's list.
export function oneGateAsk(w: string, task: string, sha: string) {
  const asks = openAsks(w);
  expect(asks).toHaveLength(1);
  expect(asks[0]).toMatchObject({
    subject: `task:${task}`,
    kind: "gate",
    title: "Merge add-a?",
    link: "https://github.com/o/r/pull/7",
    sha,
  });
  return asks[0];
}

// The loop guard's last strike: the gate already failed on the commits
// before this one.
export const failedBefore = (w: string, task: string, gate: string) => {
  for (let i = 1; i < LOOP_GUARD_COMMITS; i++)
    recordFailure(w, task, gate, `earlier ${i}`, String(i).repeat(40));
};

// Facts for the task: its agent idle, or busy.
export const taskFacts = (task: string, status: "idle" | "running" = "idle") =>
  [
    { id: task, name: "add-a", status, task: { state: "review", pr: S.pr } },
  ] as unknown as SessionFacts[];

// A failed-twice escalation's ask goes up once the agent is idle and CI
// has settled; `after` ms from now.
// The first look at a head's checks starts CI's settle clock, so it looks
// twice, the second a settle period later.
export const askUp = async (
  w: string,
  task: string,
  after = HOLD_MIN_MS + 1000,
  status: "idle" | "running" = "idle"
) => {
  await raiseHeldAsks(w, taskFacts(task, status), Date.now() + after);
  await raiseHeldAsks(w, taskFacts(task, status), Date.now() + after + 200_000);
};

// Poll for the condition, generously: a loaded machine is slow, not wrong.
export const POLL = { timeout: 20000, interval: 20 };

beforeAll(() => {
  const home = tempDir("aos-orch-signoff-");
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  merges.length = 0;
  S.refuseMerge = null;
  S.probeOut = "0";
  S.ciLog =
    "Test 1\tRun tests\t2026-01-01T00:00:00.0Z  FAIL  src/a.test.ts > adds\n";
  clearRepoCI();
  // A live terminal at its prompt, nothing waiting.
  S.pane = "❯ ";
});

export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: {
      ...process.env,
      ...(S.commitDate ? { GIT_COMMITTER_DATE: S.commitDate } : {}),
    },
  }).trim();

export function commit(
  repo: string,
  file: string,
  text: string,
  link?: string
): string {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  if (link) fs.symlinkSync(link, path.join(repo, file));
  else fs.writeFileSync(path.join(repo, file), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", `change ${file}`);
  git(repo, "push", "-q", "origin", "HEAD");
  return git(repo, "rev-parse", "HEAD");
}

// A workspace whose project is a real clone, with a task on its branch
// and its PR open at the branch's head.
export function setup(
  opts: {
    card?: boolean;
    onMain?: Array<[string, string]>;
    approvals?: boolean;
  } = {}
) {
  setMergeApprovals(opts.approvals ?? false);
  const root = tempDir("aos-orch-repo-");
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, repo);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  commit(repo, "README.md", "hello\n");
  for (const file of opts.onMain ?? []) commit(repo, ...file);
  git(repo, "checkout", "-qb", "feature/t");
  const sha = commit(repo, "src/a.ts", "export const a = 1;\n");

  const workspace = createWorkspace(`ws-${path.basename(root)}`);
  const project = createProject({
    name: `app-${path.basename(root)}`,
    workingDirectory: repo,
  });
  setProjectWorkspace(project.id, workspace.id);
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
    lh_card_id: opts.card ? "card-1" : null,
    pr_number: 7,
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
  // CI has looked settled on every head for a while.
  const settled = () =>
    putCheck({
      workspaceId: w,
      sessionId: task,
      sha: S.pr!.head!,
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: S.pr!.checkCount, at: 0 }),
    });
  return {
    w,
    repo,
    task,
    sha,
    signOff: (settle = true) => {
      if (settle) settled();
      return runTool(w, "sign_off", { task: "add-a" });
    },
    push: (file: string, text: string, link?: string) => {
      const next = commit(repo, file, text, link);
      S.pr = { ...S.pr!, head: next };
      return next;
    },
  };
}

// A reviewer that answers without a model, and remembers how it was run.
export function reviewer(verdict: "pass" | "block", within = true) {
  const runs: ClaudeRun[] = [];
  const claude = async (run: ClaudeRun) => {
    runs.push(run);
    if (!run.tools.length)
      return {
        within,
        reason: within ? "matches the card" : "adds billing, not on the card",
      };
    return verdict === "pass"
      ? { verdict, summary: "Looks right.", findings: [] }
      : {
          verdict,
          summary: "One bug.",
          findings: [
            {
              severity: "blocking",
              file: "src/a.ts",
              line: 1,
              summary: "off by one",
            },
          ],
        };
  };
  return { claude, runs };
}

export const reviewNow = (
  w: string,
  verdict: "pass" | "block" = "pass",
  within = true
) => {
  const r = reviewer(verdict, within);
  return review(w, "add-a", { wait: true, claude: r.claude }).then((text) => ({
    text,
    runs: r.runs,
  }));
};
