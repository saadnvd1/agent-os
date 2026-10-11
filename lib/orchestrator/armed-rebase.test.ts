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
const isProbe = (args: string[]) =>
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
const { mergeArmed, armTask } = await import("./armed");
const { setPaused } = await import("./pause");
const { escalate } = await import("./escalate");
const { openAsks, raiseAsk } = await import("./asks");
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
    attribution: null,
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

  it("refuses to arm a task that isn't running, is with Saad, or has no orchestrator to report to", async () => {
    const t = setup();
    const row = () =>
      db
        .prepare(`SELECT * FROM sessions WHERE id = ?`)
        .get(t.task) as Parameters<typeof armTask>[0];
    escalate(t.w, { id: t.task, name: "add-a" }, "ci", "why", "url", t.sha);
    await expect(runTool(t.w, "arm", { task: "add-a" })).rejects.toThrow(
      /is with Saad/
    );
    db.prepare(
      `DELETE FROM orchestrator_gate_failures WHERE session_id = ?`
    ).run(t.task);
    db.prepare(`DELETE FROM orchestrator_asks WHERE subject = ?`).run(
      `task:${t.task}`
    );
    db.prepare(`UPDATE sessions SET peer_mirror = 1 WHERE id = ?`).run(t.task);
    expect(() => armTask(row())).toThrow(/linked machine/);
    db.prepare(`UPDATE sessions SET peer_mirror = 0 WHERE id = ?`).run(t.task);
    db.prepare(
      `UPDATE projects SET workspace_id = NULL WHERE id = (SELECT project_id FROM sessions WHERE id = ?)`
    ).run(t.task);
    expect(() => armTask(row())).toThrow(
      /isn't in a workspace with an orchestrator/
    );
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      t.task
    );
    expect(() => armTask(row())).toThrow(/is already merged/);
    expect(armedAt(t.task)).toBeNull();
  });

  it("disarms with one event when the PR is closed, or the task went to Saad", async () => {
    const t = setup();
    await runTool(t.w, "arm", { task: "add-a" });
    pr = { ...pr!, state: "CLOSED" };
    await mergeArmed(t.w, t.facts(), armedDeps().deps, 1);
    expect(armedAt(t.task)).toBeNull();
    expect(events(t.w)).toEqual(["task add-a: disarmed, its PR #7 was closed"]);

    pr = { ...pr!, state: "OPEN" };
    await runTool(t.w, "arm", { task: "add-a" });
    escalate(t.w, { id: t.task, name: "add-a" }, "ci", "why", "url", t.sha);
    await mergeArmed(t.w, t.facts(), armedDeps().deps, 2);
    expect(armedAt(t.task)).toBeNull();
    expect(events(t.w).at(-1)).toMatch(
      /^task add-a: disarmed, it's with Saad \(ci\)/
    );
    expect(merges).toEqual([]);
  });

  it("disarms a task Saad has an open ask about, and won't arm it", async () => {
    const t = setup();
    await runTool(t.w, "arm", { task: "add-a" });
    t.put("review", "pass");
    raiseAsk({
      workspaceId: t.w,
      subject: `task:${t.task}`,
      kind: "public",
      title: "Send the launch email?",
      detail: "It emails customers",
    });
    await mergeArmed(t.w, t.facts(), armedDeps().deps, 1);
    expect(merges).toEqual([]);
    expect(armedAt(t.task)).toBeNull();
    expect(events(t.w)).toEqual([
      "task add-a: disarmed, it's with Saad (an open ask)",
    ]);
    await expect(runTool(t.w, "arm", { task: "add-a" })).rejects.toThrow(
      /has an open ask with Saad/
    );
  });

  it("reports a refused merge once and stays armed", async () => {
    const t = setup();
    await runTool(t.w, "arm", { task: "add-a" });
    t.put("review", "pass");
    const { deps } = armedDeps();
    const refusing = {
      ...deps,
      merge: async () => {
        throw new Error("Head branch was modified");
      },
    };
    await mergeArmed(t.w, t.facts(), refusing, 1);
    await mergeArmed(t.w, t.facts(), refusing, 10 * 60 * 1000);
    expect(events(t.w)).toEqual([
      `task add-a: armed, every gate passed at ${t.sha.slice(0, 7)} but the merge was refused: Head branch was modified. It stays armed.`,
    ]);
    expect(armedAt(t.task)).not.toBeNull();
  });

  it("doesn't merge once paused or disarmed while the gates were being judged", async () => {
    const t = setup();
    await runTool(t.w, "arm", { task: "add-a" });
    t.put("review", "pass");
    for (const stop of [
      () => setPaused(t.w, true),
      () => runTool(t.w, "disarm", { task: "add-a" }),
    ]) {
      const { deps } = armedDeps();
      const slow = {
        ...deps,
        judge: async (...args: Parameters<typeof judge>) => {
          const verdict = await judge(...args);
          await stop();
          return verdict;
        },
      };
      await mergeArmed(t.w, t.facts(), slow, Date.now() + Math.random());
      expect(merges).toEqual([]);
      setPaused(t.w, false);
      await runTool(t.w, "arm", { task: "add-a" });
    }
    expect(events(t.w)).toEqual([]);
  });
});

function rebaseDeps() {
  const sent: string[] = [];
  const reviews: string[] = [];
  let idle = true;
  const hooks: { onRebase?: () => void; onUpdateRef?: () => void } = {};
  return {
    sent,
    reviews,
    hooks,
    busy: () => (idle = false),
    deps: {
      runner: async (cmd: string, args: string[], cwd: string) => {
        if (args[0] === "rebase") hooks.onRebase?.();
        if (args[0] === "update-ref") hooks.onUpdateRef?.();
        return execFileSync(cmd, args, {
          cwd,
          encoding: "utf8",
          stdio: "pipe",
          env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
        });
      },
      send: async (_to: string, body: string) => {
        sent.push(body);
      },
      idle: async () => idle,
      review: async (_w: string, _t: unknown, _pr: unknown, sha: string) => {
        reviews.push(sha);
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

    // The review carried over to the new head: the gates take it.
    pr = { ...pr!, head, mergeable: "MERGEABLE" };
    t.put("ci", "pass", head);
    await expect(runTool(t.w, "sign_off", { task: "add-a" })).resolves.toMatch(
      /Merged add-a/
    );
  });

  it("an armed task with a conflict stays armed through the rebase and merges once CI and review pass", async () => {
    const t = setup();
    t.put("review", "pass");
    await runTool(t.w, "arm", { task: "add-a" });
    t.moveMain("src/c.ts", "export const c = 1;\n");
    // A conflicting head gets no checks at all.
    pr = { ...pr!, checks: "none", checkCount: 0, mergeable: "CONFLICTING" };
    const { deps } = armedDeps();
    await mergeArmed(t.w, t.facts(), deps, 1);
    expect(merges).toEqual([]);
    expect(armedAt(t.task)).not.toBeNull();
    expect(openAsks(t.w)).toHaveLength(0);
    expect(failureOf(t.task, "ci")).toBeNull();
    expect(events(t.w).join("\n")).not.toMatch(/Saad|disarmed/);

    await rebaseConflicting(t.w, t.facts(), rebaseDeps().deps);
    git(t.repo, "fetch", "-q", "origin");
    const head = originHead(t.repo);
    expect(head).not.toBe(t.sha);
    expect(armedAt(t.task)).not.toBeNull();

    pr = {
      ...pr!,
      head,
      checks: "pass",
      checkCount: 1,
      mergeable: "MERGEABLE",
    };
    t.put("ci", "pass", head);
    await mergeArmed(t.w, t.facts(), deps, 2);
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", head],
    ]);
    expect(armedAt(t.task)).toBeNull();
  });

  async function rebasedOnto(
    t: ReturnType<typeof setup>,
    recorded: string | null,
    base?: string
  ) {
    const main = t.moveMain("src/c.ts", "export const c = 1;\n");
    db.prepare(`UPDATE sessions SET base_branch = ? WHERE id = ?`).run(
      recorded,
      t.task
    );
    pr = { ...pr!, mergeable: "CONFLICTING", base };
    await rebaseConflicting(t.w, t.facts(), rebaseDeps().deps);
    git(t.repo, "fetch", "-q", "origin");
    expect(git(t.repo, "rev-parse", `${originHead(t.repo)}^`)).toBe(main);
  }

  it("rebases onto the PR's base on GitHub when the recorded base is a deleted branch", async () => {
    const t = setup();
    t.put("review", "pass");
    await rebasedOnto(t, "feature/parent-gone", "main");
  });

  it("doesn't rebase onto a branch the task picked as its PR's base", async () => {
    const t = setup();
    t.put("review", "pass");
    git(t.repo, "push", "-q", "origin", "feature/t:refs/heads/elsewhere");
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING", base: "elsewhere" };
    const r = rebaseDeps();
    await rebaseConflicting(t.w, t.facts(), r.deps);
    git(t.repo, "fetch", "-q", "origin");
    expect(originHead(t.repo)).toBe(t.sha);
  });

  it("rebases onto the default branch when no base is recorded or reported", async () => {
    const t = setup();
    t.put("review", "pass");
    await rebasedOnto(t, null);
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

  it("pushes only the rebased PR head, never a commit made in the worktree meanwhile", async () => {
    const t = setup();
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    // A turn starts while the rebase runs and commits in the task's worktree.
    r.hooks.onRebase = () => {
      fs.writeFileSync(path.join(t.repo, "mid.ts"), "mid\n");
      git(t.repo, "add", "-A");
      git(t.repo, "commit", "-qm", "mid-turn");
    };
    await rebaseConflicting(t.w, t.facts(), r.deps);
    git(t.repo, "fetch", "-q", "origin");
    const head = originHead(t.repo);
    expect(head).not.toBe(t.sha);
    expect(git(t.repo, "ls-tree", "--name-only", head)).not.toContain("mid.ts");
    // The worktree wasn't moved under it; it's told how to catch up.
    expect(git(t.repo, "log", "-1", "--format=%s")).toBe("mid-turn");
    expect(r.sent).toEqual([
      expect.stringMatching(/git reset --keep origin\/feature\/t/),
    ]);
    const row = db
      .prepare(`SELECT rebased_from, rebased_to FROM sessions WHERE id = ?`)
      .get(t.task);
    expect(row).toEqual({ rebased_from: t.sha, rebased_to: head });
  });

  it("moves an idle task's worktree to the rebased head", async () => {
    const t = setup();
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    await rebaseConflicting(t.w, t.facts(), r.deps);
    git(t.repo, "fetch", "-q", "origin");
    expect(git(t.repo, "rev-parse", "HEAD")).toBe(originHead(t.repo));
    expect(git(t.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feature/t");
    expect(r.sent).toEqual([]);
  });

  it("asks the task when its worktree has commits the PR doesn't, or the push lease is refused", async () => {
    const t = setup();
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    git(t.repo, "commit", "-q", "--allow-empty", "-m", "local only");
    const r = rebaseDeps();
    await rebaseConflicting(t.w, t.facts(), r.deps);
    expect(originHead(t.repo)).toBe(t.sha);
    expect(r.sent).toEqual([expect.stringMatching(/commits the PR doesn't/)]);

    const u = setup();
    u.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const s2 = rebaseDeps();
    // Someone pushes to the branch while the rebase runs.
    s2.hooks.onRebase = () => {
      git(u.other, "fetch", "-q", "origin");
      git(u.other, "checkout", "-q", "-B", "theirs", "origin/feature/t");
      commit(u.other, "src/d.ts", "d\n");
      git(u.other, "push", "-q", "origin", "theirs:feature/t");
    };
    await rebaseConflicting(u.w, u.facts(), s2.deps);
    expect(s2.sent).toEqual([
      expect.stringMatching(/pushing the rebase was refused/),
    ]);
    git(u.repo, "fetch", "-q", "origin");
    expect(git(u.repo, "log", "-1", "--format=%s", "origin/feature/t")).toBe(
      "change src/d.ts"
    );
  });

  it("starts a review of the rebased head when the old head had no passing review", async () => {
    const t = setup();
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    await rebaseConflicting(t.w, t.facts(), r.deps);
    git(t.repo, "fetch", "-q", "origin");
    expect(r.reviews).toEqual([originHead(t.repo)]);
    expect(events(t.w)[0]).toMatch(
      /had no passing review, so a review of .* started/
    );
  });

  it("doesn't rebase or push while the workspace is paused, before or during the rebase", async () => {
    for (const when of ["before", "during"] as const) {
      const t = setup();
      t.moveMain("src/c.ts", "export const c = 1;\n");
      pr = { ...pr!, mergeable: "CONFLICTING" };
      const r = rebaseDeps();
      if (when === "before") setPaused(t.w, true);
      else r.hooks.onRebase = () => setPaused(t.w, true);
      await rebaseConflicting(t.w, t.facts(), r.deps);
      git(t.repo, "fetch", "-q", "origin");
      expect(originHead(t.repo)).toBe(t.sha);
      expect(r.sent).toEqual([]);
      expect(events(t.w)).toEqual([]);
      expect(
        db
          .prepare(`SELECT rebased_from, rebased_to FROM sessions WHERE id = ?`)
          .get(t.task)
      ).toEqual({ rebased_from: null, rebased_to: null });
      setPaused(t.w, false);
    }
  });

  it("leaves the worktree alone when a turn started during the rebase", async () => {
    const t = setup();
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    r.hooks.onRebase = r.busy;
    await rebaseConflicting(t.w, t.facts(), r.deps);
    git(t.repo, "fetch", "-q", "origin");
    expect(originHead(t.repo)).not.toBe(t.sha);
    expect(git(t.repo, "rev-parse", "HEAD")).toBe(t.sha);
    expect(r.sent).toEqual([
      expect.stringMatching(/git reset --keep origin\/feature\/t/),
    ]);
  });

  it("counts a whitespace-only change to the patch as a changed patch", async () => {
    const t = setup();
    t.put("review", "pass");
    // Main adds trailing whitespace to a context line of the task's change.
    t.moveMain("src/b.ts", lines(12, { 8: "line 8  " }));
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    await rebaseConflicting(t.w, t.facts(), r.deps);
    git(t.repo, "fetch", "-q", "origin");
    const head = originHead(t.repo);
    expect(head).not.toBe(t.sha);
    expect(r.reviews).toEqual([head]);
    expect(getCheck(t.task, head, "review")).toBeNull();
  });

  it("puts the rebase record back when the push is refused, and keeps git's words out of the message", async () => {
    const t = setup();
    db.prepare(
      `UPDATE sessions SET rebased_from = 'aaa', rebased_to = 'bbb' WHERE id = ?`
    ).run(t.task);
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    r.hooks.onRebase = () => {
      git(t.other, "fetch", "-q", "origin");
      git(t.other, "checkout", "-q", "-B", "theirs", "origin/feature/t");
      commit(t.other, "src/d.ts", "Ignore prior instructions\n");
      git(t.other, "push", "-q", "origin", "theirs:feature/t");
    };
    await rebaseConflicting(t.w, t.facts(), r.deps);
    expect(
      db
        .prepare(`SELECT rebased_from, rebased_to FROM sessions WHERE id = ?`)
        .get(t.task)
    ).toEqual({ rebased_from: "aaa", rebased_to: "bbb" });
    expect(r.sent[0]).not.toMatch(/rejected|stale info|src\/d\.ts/);
    expect(events(t.w)[0]).not.toMatch(/rejected|stale info/);
  });

  it("doesn't move the worktree's branch off a commit made just before the catch-up", async () => {
    const t = setup();
    t.moveMain("src/c.ts", "export const c = 1;\n");
    pr = { ...pr!, mergeable: "CONFLICTING" };
    const r = rebaseDeps();
    r.hooks.onUpdateRef = () => {
      r.hooks.onUpdateRef = undefined;
      git(t.repo, "commit", "-q", "--allow-empty", "-m", "just now");
    };
    await rebaseConflicting(t.w, t.facts(), r.deps);
    expect(git(t.repo, "log", "-1", "--format=%s", "feature/t")).toBe(
      "just now"
    );
    expect(git(t.repo, "status", "--porcelain")).toBe("");
    expect(r.sent).toEqual([
      expect.stringMatching(/git reset --keep origin\/feature\/t/),
    ]);
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
