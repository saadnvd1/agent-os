import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPR } from "@/lib/tasks/state";
import type { SessionFacts } from "./facts";

// A real repository with a local bare remote; gh is faked around it.
let pr: TaskPR | null = null;
const merges: string[][] = [];

vi.mock("@/lib/tasks/gh", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tasks/gh")>();
  return {
    ...real,
    run: async (cmd: string, args: string[], cwd: string, t?: number) => {
      if (cmd === "gh") {
        merges.push(args);
        if (pr) pr = { ...pr, state: "MERGED" };
        return "";
      }
      if (cmd === "tmux") throw new Error("no tmux in tests");
      return real.run(cmd, args, cwd, t);
    },
    findPR: async () => pr,
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

const { db } = await import("@/lib/db");
const { createProject } = await import("@/lib/projects");
const { createWorkspace, setProjectWorkspace } =
  await import("@/lib/workspaces");
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { getCheck, putCheck } = await import("./checks");
const { failureOf, recordFailure } = await import("./gates");
const { seedSession } = await import("./testing");
const { setMergeApprovals } = await import("./merge-approvals");
const { mergeArmed } = await import("./armed");
const { judge, mergeJudged } = await import("./signoff");
const { rebaseConflicting } = await import("./rebase");
const { recordConditions } = await import("./events");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-armed-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  merges.length = 0;
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
  }).trim();

function commit(repo: string, file: string, text: string): string {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", `change ${file}`);
  git(repo, "push", "-q", "origin", "HEAD");
  return git(repo, "rev-parse", "HEAD");
}

const lines = (n: number, change: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => change[i + 1] ?? `line ${i + 1}`).join(
    "\n"
  ) + "\n";

// A workspace whose project is a real clone, which is also the task's
// worktree, on its branch with its PR open at the branch's head. `other`
// is a second clone for moving main.
function setup() {
  setMergeApprovals(false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-armed-repo-"));
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
  ensureOrchestrator(workspace.id);
  const task = seedSession({
    projectId: project.id,
    name: "add-a",
    task: true,
    branch: "feature/t",
  });
  db.prepare(
    `UPDATE sessions SET base_branch = 'main', task_prompt = 'Add a', pr_number = 7, worktree_path = ? WHERE id = ?`
  ).run(repo, task);
  pr = {
    number: 7,
    url: "https://github.com/o/r/pull/7",
    state: "OPEN",
    checks: "pass",
    head: sha,
    failing: null,
    checkCount: 1,
    codeReview: { sha },
  };
  const w = workspace.id;
  const put = (
    kind: "review" | "ci",
    status: "pass" | "block",
    at = pr!.head!
  ) =>
    putCheck({
      workspaceId: w,
      sessionId: task,
      sha: at,
      kind,
      status,
      detail:
        kind === "ci"
          ? JSON.stringify({ count: pr!.checkCount, at: 0 })
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
        task: { state: "review", pr, blocked: null, ciSettleIn: 0 },
        stack: null,
      },
    ],
  };
}

const events = (w: string) =>
  (
    db
      .prepare(
        `SELECT key, line FROM orchestrator_events WHERE workspace_id = ? AND key LIKE 'once:%' ORDER BY id`
      )
      .all(w) as { key: string; line: string }[]
  ).map((e) => e.line);

const armedAt = (task: string) =>
  (
    db
      .prepare(`SELECT merge_armed_at FROM sessions WHERE id = ?`)
      .get(task) as { merge_armed_at: string | null }
  ).merge_armed_at;

function armedDeps() {
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

describe("arm", () => {
  it("merges an armed task once every gate passes at its head, with one event", async () => {
    const t = setup();
    await expect(runTool(t.w, "arm", { task: "add-a" })).resolves.toMatch(
      /^Armed add-a/
    );
    const { deps, reviews } = armedDeps();
    // CI green, no review yet: it starts one itself and waits, quietly.
    await mergeArmed(t.w, t.facts(), deps, 1);
    expect(reviews).toEqual([t.task]);
    expect(merges).toEqual([]);
    expect(events(t.w)).toEqual([]);

    t.put("review", "pass");
    await mergeArmed(t.w, t.facts(), deps, 2);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", t.sha],
    ]);
    expect(events(t.w)).toEqual([
      `task add-a: Merged add-a: PR #7 squash-merged at ${t.sha.slice(0, 7)}. (armed: every gate passed)`,
    ]);
    expect(armedAt(t.task)).toBeNull();
    // The merged condition isn't sent again on the next diff.
    const ready = recordConditions(
      t.w,
      [
        {
          key: `merged:${t.task}`,
          subject: t.task,
          line: "task add-a: merged",
          sticky: true,
        },
      ],
      [t.task]
    );
    expect(ready).toEqual([]);
  });

  it("reports a failing gate once, counts it once and stays armed", async () => {
    const t = setup();
    await runTool(t.w, "arm", { task: "add-a" });
    t.put("review", "block");
    const { deps } = armedDeps();
    await mergeArmed(t.w, t.facts(), deps, 1);
    // Looked at again later with nothing changed: no second event or count.
    await mergeArmed(t.w, t.facts(), deps, 10 * 60 * 1000);
    expect(merges).toEqual([]);
    const said = events(t.w);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(
      /^task add-a: armed, not merged yet; it stays armed and merges once this is fixed\.\n.*\n- review failed \(first\)/
    );
    expect(failureOf(t.task, "review")?.count).toBe(1);
    expect(armedAt(t.task)).not.toBeNull();
  });

  it("disarms on a failure that goes to Saad", async () => {
    const t = setup();
    await runTool(t.w, "arm", { task: "add-a" });
    // The review gate failed once on an earlier commit; failing again
    // sends it to Saad.
    recordFailure(t.w, t.task, "review", "earlier", "0".repeat(40));
    t.put("review", "block");
    await mergeArmed(t.w, t.facts(), armedDeps().deps, 1);
    expect(merges).toEqual([]);
    expect(armedAt(t.task)).toBeNull();
    expect(events(t.w)[0]).toMatch(
      /^task add-a: armed merge stopped and disarmed, it went to Saad\./
    );
  });

  it("arms and disarms by task or PR number, as a flag in the database", async () => {
    const t = setup();
    await runTool(t.w, "arm", { task: "add-a" });
    expect(armedAt(t.task)).not.toBeNull();
    await expect(runTool(t.w, "disarm", { task: "#7" })).resolves.toMatch(
      /^Disarmed add-a/
    );
    expect(armedAt(t.task)).toBeNull();
  });
});

function rebaseDeps() {
  const sent: string[] = [];
  const reviews: string[] = [];
  const bodies: [string, string][] = [];
  let idle = true;
  return {
    sent,
    reviews,
    bodies,
    busy: () => (idle = false),
    deps: {
      runner: async (cmd: string, args: string[], cwd: string) =>
        execFileSync(cmd, args, {
          cwd,
          encoding: "utf8",
          stdio: "pipe",
          env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
        }),
      send: async (_to: string, body: string) => {
        sent.push(body);
      },
      idle: async () => idle,
      review: async (_w: string, _t: unknown, _pr: unknown, sha: string) => {
        reviews.push(sha);
      },
      editBody: async (_r: string, _n: number, from: string, to: string) => {
        bodies.push([from, to]);
      },
    },
  };
}

const originHead = (repo: string) => git(repo, "rev-parse", "origin/feature/t");

describe("automatic rebase", () => {
  it("rebases a clean PR onto main, pushes only its branch, carries its review over, and the gates accept the head", async () => {
    const t = setup();
    t.put("review", "pass");
    const main = t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    await rebaseConflicting(t.w, t.facts(), r.deps);

    git(t.repo, "fetch", "-q", "origin");
    const head = originHead(t.repo);
    expect(head).not.toBe(t.sha);
    expect(git(t.repo, "rev-parse", `${head}^`)).toBe(main);
    expect(git(t.repo, "rev-parse", "origin/main")).toBe(main);
    expect(r.sent).toEqual([]);
    expect(r.bodies).toEqual([[t.sha, head]]);
    // Same patch: the review carries over, no fresh one.
    expect(r.reviews).toEqual([]);
    expect(getCheck(t.task, head, "review")).toMatchObject({
      status: "pass",
    });
    expect(getCheck(t.task, head, "review")?.detail).toMatch(
      /Carried over from .*same git patch-id/
    );
    expect(events(t.w)).toEqual([
      expect.stringMatching(
        /^task add-a: PR #7 conflicted with main; AgentOS rebased it cleanly .* the review of .* carries over \(same patch\)\.$/
      ),
    ]);

    // The Code review section still names the old head: the gates take it.
    pr = { ...pr!, head, mergeable: "MERGEABLE", codeReview: { sha: t.sha } };
    t.put("ci", "pass", head);
    await expect(runTool(t.w, "sign_off", { task: "add-a" })).resolves.toMatch(
      /Merged add-a/
    );
  });

  it("starts a fresh review when the rebase changed the PR's own patch", async () => {
    const t = setup();
    t.put("review", "pass");
    // Main changes a line next to the task's: merges cleanly, but the
    // task's diff now has different context.
    t.moveMain("src/b.ts", lines(12, { 7: "main's seven" }));
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    await rebaseConflicting(t.w, t.facts(), r.deps);
    git(t.repo, "fetch", "-q", "origin");
    const head = originHead(t.repo);
    expect(head).not.toBe(t.sha);
    expect(r.reviews).toEqual([head]);
    expect(getCheck(t.task, head, "review")).toBeNull();
    expect(events(t.w)[0]).toMatch(/its patch changed in the rebase/);
  });

  it("asks a conflicting task once to rebase, and doesn't touch its branch", async () => {
    const t = setup();
    t.moveMain("src/b.ts", lines(12, { 5: "main's five" }));
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    // Even mid-turn: the message waits for its next prompt.
    await rebaseConflicting(t.w, t.facts("running"), r.deps);
    await rebaseConflicting(t.w, t.facts("idle"), r.deps);
    expect(originHead(t.repo)).toBe(t.sha);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatch(
      /^Your PR #7 conflicts with main, and AgentOS couldn't rebase it for you: its changes conflict with main\./
    );
    expect(events(t.w)).toEqual([
      expect.stringMatching(
        /^task add-a: PR #7 conflicts with main and can't be rebased automatically .*asked it once to rebase\.$/
      ),
    ]);
  });

  it("never rebases mid-turn or over uncommitted work", async () => {
    const t = setup();
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    await rebaseConflicting(t.w, t.facts("running"), r.deps);
    await rebaseConflicting(t.w, t.facts("waiting"), r.deps);
    // Idle by the facts, but its turn started since.
    r.busy();
    await rebaseConflicting(t.w, t.facts("idle"), r.deps);
    expect(originHead(t.repo)).toBe(t.sha);
    expect(r.sent).toEqual([]);
    expect(events(t.w)).toEqual([]);

    // Idle, with work it hasn't committed: asked, not rebased.
    const idle = rebaseDeps();
    fs.writeFileSync(path.join(t.repo, "wip.ts"), "wip\n");
    await rebaseConflicting(t.w, t.facts("idle"), idle.deps);
    expect(originHead(t.repo)).toBe(t.sha);
    expect(git(t.repo, "rev-parse", "HEAD")).toBe(t.sha);
    expect(idle.sent).toHaveLength(1);
    expect(idle.sent[0]).toMatch(/its worktree has uncommitted changes/);
  });

  it("leaves a PR GitHub calls mergeable alone", async () => {
    const t = setup();
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "MERGEABLE" };
    const r = rebaseDeps();
    await rebaseConflicting(t.w, t.facts(), r.deps);
    expect(originHead(t.repo)).toBe(t.sha);
    expect(events(t.w)).toEqual([]);
  });
});
