import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPR } from "@/lib/tasks/state";

// A home of its own before anything reads it: the worktrees folder is
// fixed when lib/worktrees loads.
const home = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "aos-quick-"))
);
vi.spyOn(os, "homedir").mockReturnValue(home);

// gh is faked: `pr create` opens PR #31 at the pushed head, which the PR
// lookups then find.
let pr: TaskPR | null = null;
const ghCalls: string[][] = [];
vi.mock("@/lib/tasks/gh", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tasks/gh")>();
  return {
    ...real,
    run: async (cmd: string, args: string[], cwd: string, t?: number) => {
      if (cmd === "gh") {
        ghCalls.push(args);
        if (args[0] === "pr" && args[1] === "create") {
          const head = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd,
            encoding: "utf8",
          }).trim();
          pr = {
            number: 31,
            url: "https://github.com/o/r/pull/31",
            state: "OPEN",
            checks: "pending",
            head,
            failing: null,
            checkCount: 0,
          };
          return `${pr.url}\n`;
        }
        return "";
      }
      if (cmd === "tmux") throw new Error("no tmux in tests");
      return real.run(cmd, args, cwd, t);
    },
    findPR: async () => pr,
  };
});
const reviews: string[] = [];
vi.mock("./review", async (importOriginal) => {
  const real = await importOriginal<typeof import("./review")>();
  return {
    ...real,
    review: async (_w: string, id: string) => {
      reviews.push(id);
      return "Reviewing it.";
    },
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
const { putCheck } = await import("./checks");
const { seedSession } = await import("./testing");
const { setMergeApprovals } = await import("./merge-approvals");
const { judge } = await import("./signoff");
const { orchestratorToolRefusal } = await import("./write-guard");
const { pushRefusal, withQuickReview } = await import("./quick");
const { WORKTREES_DIR } = await import("@/lib/worktrees");
const { buildShelves } = await import("@/lib/sidebar/shelves");

const OLD = { GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...OLD },
  }).trim();

function commit(repo: string, file: string, text: string): string {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", `change ${file}`);
  git(repo, "push", "-q", "origin", "HEAD");
  return git(repo, "rev-parse", "HEAD");
}

// A workspace with an orchestrator and a project that's a real clone of a
// local bare remote, and another task's worktree in the worktrees folder.
function setup() {
  setMergeApprovals(false);
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "aos-quick-repo-"))
  );
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, repo);
  const base = commit(repo, "README.md", "hello\n");
  const workspace = createWorkspace(`ws-${path.basename(root)}`);
  const project = createProject({
    name: `app-${path.basename(root)}`,
    workingDirectory: repo,
  });
  setProjectWorkspace(project.id, workspace.id);
  const orchestrator = ensureOrchestrator(workspace.id);
  const other = path.join(WORKTREES_DIR, `${path.basename(root)}-other`);
  git(repo, "worktree", "add", "-q", "-b", "feature/other", other);
  const otherTask = seedSession({
    projectId: project.id,
    name: "other-task",
    task: true,
    branch: "feature/other",
  });
  db.prepare(`UPDATE sessions SET worktree_path = ? WHERE id = ?`).run(
    other,
    otherTask
  );
  return {
    w: workspace.id,
    project,
    orchestrator,
    repo,
    remote,
    base,
    other,
  };
}

const row = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as {
    id: string;
    name: string;
    quick_of: string | null;
    worktree_path: string;
    branch_name: string;
    base_branch: string;
    task_status: string;
    task_prompt: string;
    pr_number: number | null;
    view: string;
  };

async function quickChange(s: ReturnType<typeof setup>, name = "fix typo") {
  const text = await runTool(s.w, "quick_change", {
    project: s.project.name,
    name,
  });
  const id = (
    db
      .prepare(
        `SELECT id FROM sessions WHERE quick_of = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
      )
      .get(s.orchestrator.id) as { id: string }
  ).id;
  return { text, id, wt: row(id).worktree_path };
}

beforeEach(() => {
  pr = null;
  ghCalls.length = 0;
  reviews.length = 0;
});

describe("quick_change", () => {
  it("cuts an agentless task's worktree from the default branch, owned by the orchestrator", async () => {
    const s = setup();
    const { text, id, wt } = await quickChange(s);
    const r = row(id);
    expect(r.quick_of).toBe(s.orchestrator.id);
    expect(r.task_status).toBe("running");
    expect(r.base_branch).toBe("main");
    expect(r.branch_name).toMatch(/^feature\/quick-fix-typo-/);
    expect(wt.startsWith(`${WORKTREES_DIR}/`)).toBe(true);
    expect(text).toContain(wt);
    expect(git(wt, "rev-parse", "HEAD")).toBe(s.base);
    expect(git(wt, "branch", "--show-current")).toBe(r.branch_name);
  });

  it("refuses a project outside the workspace", async () => {
    const s = setup();
    const elsewhere = createProject({
      name: `elsewhere-${Date.now()}`,
      workingDirectory: s.repo,
    });
    await expect(
      runTool(s.w, "quick_change", { project: elsewhere.name, name: "x" })
    ).rejects.toThrow(/No project/);
  });
});

describe("the write guard with a quick change open", () => {
  const write = (s: ReturnType<typeof setup>, file: string) =>
    orchestratorToolRefusal(row(s.orchestrator.id) as never, "Write", {
      file_path: file,
    });
  const bash = (s: ReturnType<typeof setup>, command: string) =>
    orchestratorToolRefusal(row(s.orchestrator.id) as never, "Bash", {
      command,
    });

  let s: ReturnType<typeof setup>;
  let wt: string;
  beforeAll(async () => {
    s = setup();
    ({ wt } = await quickChange(s));
    // Ways out of its worktree that look like ways in.
    fs.symlinkSync(s.repo, path.join(wt, "main-link"));
    fs.symlinkSync(s.other, path.join(wt, "other-link"));
  });

  it("allows writes in its own quick worktree", async () => {
    expect(await write(s, path.join(wt, "README.md"))).toBeNull();
    expect(await write(s, path.join(wt, "src/new/file.ts"))).toBeNull();
  });

  it("refuses the project's main checkout", async () => {
    expect(await write(s, path.join(s.repo, "README.md"))).toMatch(
      /project repository/
    );
  });

  it("refuses another task's worktree", async () => {
    expect(await write(s, path.join(s.other, "README.md"))).toMatch(
      /project repository, task worktree/
    );
  });

  it("refuses symlink and .. tricks out of it", async () => {
    expect(await write(s, path.join(wt, "main-link/README.md"))).toMatch(
      /project repository/
    );
    expect(await write(s, path.join(wt, "other-link/x.ts"))).toMatch(
      /task worktree/
    );
    expect(
      await write(s, `${wt}/../${path.basename(s.other)}/README.md`)
    ).toMatch(/task worktree/);
    expect(await write(s, `${wt}/../../.env`)).toMatch(/state|secrets/);
  });

  it("still refuses git, agent config and secrets inside it", async () => {
    expect(await write(s, path.join(wt, ".git"))).toMatch(/configures/);
    expect(await write(s, path.join(wt, "CLAUDE.md"))).toMatch(/configures/);
    expect(await write(s, path.join(wt, ".env"))).toMatch(/secrets/);
  });

  it("refuses another orchestrator's quick worktree", async () => {
    const t = setup();
    const theirs = await quickChange(t, "their change");
    expect(await write(s, path.join(theirs.wt, "README.md"))).toMatch(
      /task worktree/
    );
  });

  it("refuses a dropped quick change's worktree", async () => {
    const gone = await quickChange(s, "to drop");
    await runTool(s.w, "drop", { task: gone.id, reason: "not needed" });
    expect(row(gone.id).task_status).toBe("dropped");
    expect(fs.existsSync(gone.wt)).toBe(false);
    expect(await write(s, path.join(gone.wt, "README.md"))).not.toBeNull();
  });

  it("runs git only with -C in its own quick worktree", async () => {
    expect(await bash(s, `git -C ${wt} status`)).toBeNull();
    expect(await bash(s, `git -C '${wt}' diff --stat`)).toBeNull();
    expect(await bash(s, `git -C ${wt} add -A`)).toBeNull();
    expect(await bash(s, `git status`)).toMatch(/quick changes' worktrees/);
    expect(await bash(s, `git -C ${s.repo} status`)).toMatch(
      /isn't one of your quick changes/
    );
    expect(await bash(s, `git -C ${s.other} add -A`)).toMatch(
      /isn't one of your quick changes/
    );
    expect(
      await bash(s, `git -C ${wt}/../${path.basename(s.other)} add -A`)
    ).toMatch(/isn't one of your quick changes/);
    expect(await bash(s, `git -C ${wt}/main-link status`)).toMatch(
      /isn't one of your quick changes/
    );
  });

  it("refuses a push from the shell, to the default branch or any", async () => {
    expect(await bash(s, `git -C ${wt} push origin main`)).toMatch(
      /pushes to the default branch/
    );
    expect(await bash(s, `git -C ${wt} push origin HEAD:main`)).toMatch(
      /quick_pr pushes/
    );
    expect(await bash(s, `git -C ${wt} push`)).toMatch(/quick_pr pushes/);
  });

  it("refuses git that runs hooks, other code, or writes elsewhere", async () => {
    for (const cmd of [
      `git -C ${wt} commit -m x`,
      `git -C ${wt} config core.hooksPath /tmp`,
      `git -C ${wt} checkout main`,
      `git -C ${wt} stash`,
      `git -c core.hooksPath=/tmp -C ${wt} status`,
      `git --git-dir=${s.repo}/.git -C ${wt} status`,
      `git -C ${wt} -C ${s.repo} status`,
      `git -C ${wt} log --output=/tmp/x`,
      `git -C ${wt} diff --ext-diff`,
      `git -C ${wt} show --textconv HEAD:README.md`,
      `git -C ${wt} rebase --exec true`,
      `git -C ${wt} diff --ext-di`,
      `git -C ${wt} show --textc HEAD:README.md`,
      `git -C ${wt} diff --no-index -- /etc/hosts /dev/null`,
    ])
      expect(await bash(s, cmd), cmd).toMatch(/Refused/);
  });

  it("refuses anything a shell would chain, redirect or expand", async () => {
    for (const cmd of [
      `git -C ${wt} status && rm -rf /`,
      `git -C ${wt} status; git -C ${s.repo} push`,
      `git -C ${wt} status | sh`,
      `git -C ${wt} show HEAD > /tmp/x`,
      `git -C $(echo ${s.repo}) status`,
      `git -C ${wt} add "$(touch /tmp/x)"`,
      `git -C ${wt} add \`id\``,
      `git -C ${wt} add *`,
      `aos peers && git -C ${s.repo} push`,
      `GIT_DIR=${s.repo}/.git git -C ${wt} status`,
    ])
      expect(await bash(s, cmd), cmd).toMatch(/Refused/);
    // Quoted, the same characters are only text.
    expect(await bash(s, `git -C ${wt} add 'a;b|c.md'`)).toBeNull();
    expect(await bash(s, `aos notify "Stack landed: 3 PRs"`)).toBeNull();
  });
});

describe("quick_pr", () => {
  it("commits, pushes its branch and opens a PR gated like a task's", async () => {
    const s = setup();
    const { id, wt } = await quickChange(s);
    fs.writeFileSync(path.join(wt, "README.md"), "hello, world\n");
    const text = await runTool(s.w, "quick_pr", {
      change: id,
      title: "Fix the greeting",
      body: "The README said hello without the world.",
    });
    const r = row(id);
    const head = git(wt, "rev-parse", "HEAD");
    expect(text).toMatch(/Opened PR #31/);
    expect(text).toMatch(/gates/);
    // Its branch is on origin at the commit; the default branch is not moved.
    expect(git(s.remote, "rev-parse", `refs/heads/${r.branch_name}`)).toBe(
      head
    );
    expect(git(s.remote, "rev-parse", "refs/heads/main")).toBe(s.base);
    expect(git(wt, "log", "-1", "--format=%s")).toBe("Fix the greeting");
    const create = ghCalls.find((a) => a[1] === "create")!;
    expect(create).toEqual(
      expect.arrayContaining(["--base", "main", "--head", r.branch_name])
    );
    expect(r.pr_number).toBe(31);
    expect(r.task_prompt).toContain("The README said hello");
    // Its review, its code-review gate, starts at once.
    expect(reviews).toEqual([id]);
    // Gated: no review of the head yet, so it can't merge.
    const verdict = await judge(s.w, r as never);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.wait).toBe(true);
      expect(verdict.text).toMatch(/independent review/);
    }
  });

  it("refuses with nothing changed", async () => {
    const s = setup();
    const { id } = await quickChange(s);
    await expect(
      runTool(s.w, "quick_pr", { change: id, title: "t", body: "b" })
    ).rejects.toThrow(/nothing to commit/);
    expect(ghCalls.some((a) => a[1] === "create")).toBe(false);
  });

  it("never pushes to the default branch", async () => {
    const s = setup();
    const { id, wt } = await quickChange(s);
    // Its row and worktree pointed at the default branch.
    git(wt, "checkout", "-q", "--detach");
    git(s.repo, "checkout", "-q", "--detach");
    git(wt, "checkout", "-q", "main");
    db.prepare(`UPDATE sessions SET branch_name = 'main' WHERE id = ?`).run(id);
    fs.writeFileSync(path.join(wt, "README.md"), "pushed?\n");
    await expect(
      runTool(s.w, "quick_pr", { change: id, title: "t", body: "b" })
    ).rejects.toThrow(/never pushes to it/);
    expect(git(s.remote, "rev-parse", "refs/heads/main")).toBe(s.base);
    expect(pushRefusal("main", "main", "main")).toMatch(/default branch/);
    expect(pushRefusal("trunk", "trunk", "main")).toMatch(/default branch/);
    expect(pushRefusal("master", "main", "main")).toMatch(/default branch/);
    expect(pushRefusal("feature/quick-x", "main", "main")).toBeNull();
  });

  it("refuses a worktree moved off its branch", async () => {
    const s = setup();
    const { id, wt } = await quickChange(s);
    git(wt, "checkout", "-q", "-b", "elsewhere");
    fs.writeFileSync(path.join(wt, "README.md"), "x\n");
    await expect(
      runTool(s.w, "quick_pr", { change: id, title: "t", body: "b" })
    ).rejects.toThrow(/not its branch/);
  });

  it("refuses AI attribution, and a task that isn't its quick change", async () => {
    const s = setup();
    const { id, wt } = await quickChange(s);
    fs.writeFileSync(path.join(wt, "README.md"), "x\n");
    await expect(
      runTool(s.w, "quick_pr", {
        change: id,
        title: "t",
        body: "Fix\n\n🤖 Generated with [Claude Code](https://claude.com)",
      })
    ).rejects.toThrow(/attribution/);
    await expect(
      runTool(s.w, "quick_pr", { change: "other-task", title: "t", body: "b" })
    ).rejects.toThrow(/isn't one of your quick changes/);
  });
});

describe("the code-review gate", () => {
  // A PR open at an old head with green, settled CI and a passing review,
  // on a quick change or on an ordinary task.
  function gated(opts: {
    quick: boolean;
    review: boolean | "block" | "stale";
    attribution?: "a Claude-Session link" | null;
  }) {
    const s = setup();
    git(s.repo, "checkout", "-qb", `feature/g-${Date.now()}`);
    const sha = commit(s.repo, "README.md", "changed\n");
    const task = seedSession({
      projectId: s.project.id,
      name: `gated-${Math.random().toString(36).slice(2, 7)}`,
      task: true,
      branch: git(s.repo, "branch", "--show-current"),
    });
    db.prepare(
      `UPDATE sessions SET base_branch = 'main', task_prompt = 'Change it', pr_number = 7, worktree_path = ?, view = 'chat', quick_of = ? WHERE id = ?`
    ).run(s.repo, opts.quick ? s.orchestrator.id : null, task);
    pr = {
      number: 7,
      url: "https://github.com/o/r/pull/7",
      state: "OPEN",
      checks: "pass",
      head: sha,
      failing: null,
      checkCount: 1,
      attribution: opts.attribution ?? null,
    };
    putCheck({
      workspaceId: s.w,
      sessionId: task,
      sha,
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: 1, at: 0 }),
    });
    if (opts.review)
      putCheck({
        workspaceId: s.w,
        sessionId: task,
        sha: opts.review === "stale" ? "0".repeat(40) : sha,
        kind: "review",
        status: opts.review === "block" ? "block" : "pass",
        detail: "Looks right.",
      });
    return { w: s.w, task: row(task), sha };
  }

  it("for a quick_pr PR, is the passing independent review of its head", async () => {
    const g = gated({ quick: true, review: true });
    expect(await judge(g.w, g.task as never)).toMatchObject({
      ok: true,
      sha: g.sha,
    });
  });

  it.each([
    ["a review of an older head", "stale", /no independent review/],
    ["a blocking review", "block", /blocking findings/],
    ["no review", false, /no independent review/],
  ] as const)("for a quick_pr PR, waits on %s", async (_n, review, text) => {
    const g = gated({ quick: true, review });
    const v = await judge(g.w, g.task as never);
    expect(v).toMatchObject({ ok: false, wait: true });
    expect(!v.ok && v.text).toMatch(text);
  });

  it("for a quick_pr PR, still refuses AI attribution in the body", async () => {
    const g = gated({
      quick: true,
      review: true,
      attribution: "a Claude-Session link",
    });
    const v = await judge(g.w, g.task as never);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.text).toMatch(/AI attribution/);
  });

  it("for a quick_pr PR, waits on that review", async () => {
    const g = gated({ quick: true, review: false });
    const v = await judge(g.w, g.task as never);
    expect(v).toMatchObject({ ok: false, wait: true });
    expect(!v.ok && v.text).toMatch(/independent review/);
  });

  it("for any other task, is the same passing review of its head", async () => {
    const without = gated({ quick: false, review: false });
    const v = await judge(without.w, without.task as never);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.text).toMatch(/no review of/);
    const withIt = gated({ quick: false, review: true });
    expect(await judge(withIt.w, withIt.task as never)).toMatchObject({
      ok: true,
    });
  });
});

describe("the Code review section AgentOS writes after a quick change's review", () => {
  it("names the reviewed head, replacing its earlier one", () => {
    const once = withQuickReview("Fixes the greeting.", "a".repeat(40));
    const twice = withQuickReview(once, "b".repeat(40));
    expect(twice).toContain(`Reviewed: ${"b".repeat(40)}`);
    expect(twice).not.toContain("a".repeat(40));
    expect(twice.match(/## Code review/g)).toHaveLength(1);
    expect(twice.startsWith("Fixes the greeting.")).toBe(true);
  });
});

describe("the sidebar", () => {
  it("nests a quick change under the orchestrator that makes it", () => {
    const now = new Date().toISOString();
    const base = {
      archived_at: null,
      project_id: "p",
      conductor_session_id: null,
      worker_status: null,
      updated_at: now,
      created_at: now,
    };
    const shelves = buildShelves({
      sessions: [
        {
          ...base,
          id: "o",
          name: "Orchestrator",
          role: "orchestrator",
          pinned: true,
          project_id: null,
        },
        { ...base, id: "q", name: "fix typo", quick_of: "o", pinned: false },
      ] as never,
      statuses: {},
      tasks: { q: "checks-failing" },
      projectName: () => "app",
      currentOrchestrators: new Set(["o"]),
    });
    expect(shelves.orchestrators[0].quick?.map((r) => r.session.id)).toEqual([
      "q",
    ]);
    expect(shelves.orchestrators[0].quick?.[0].task).toBe("checks-failing");
    // Its failing CI is the orchestrator's to carry, not a need of Saad's.
    expect(shelves.needsYou).toEqual([]);
  });
});
