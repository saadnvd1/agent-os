import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPR, TaskState } from "@/lib/tasks/state";
import { recordPlaced } from "@/lib/worktree-placed";
import { commitFile, git, makeRepo, WORKTREE_MARK } from "./testing";

// Real repositories; gh, tmux, chat workers and LumifyHub are faked.
const prs = new Map<string, TaskPR>();
const merges: string[][] = [];
const killed: string[] = [];
const cards: [string, TaskState][] = [];
const status = new Map<string, "running" | "idle">();
const droppedDatabases: string[] = [];
let ghDown = false;
// Holds a sign-off's cleanup at its first step until released.
let cleanupGate: Promise<void> | null = null;

vi.mock("@/lib/tasks/gh", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tasks/gh")>();
  return {
    ...real,
    run: async (cmd: string, args: string[], cwd: string, t?: number) => {
      if (cmd === "gh") {
        merges.push(args);
        for (const [b, pr] of prs)
          if (String(pr.number) === args[2])
            prs.set(b, { ...pr, state: "MERGED" });
        return "";
      }
      if (cmd === "tmux") {
        await cleanupGate;
        throw new Error("no tmux in tests");
      }
      return real.run(cmd, args, cwd, t);
    },
    findPR: async (_repo: string, branch: string) => prs.get(branch) ?? null,
    findPRStrict: async (_repo: string, branch: string) => {
      if (ghDown) throw new Error("HTTP 502 from api.github.com");
      return prs.get(branch) ?? null;
    },
  };
});
vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
    listSessions: async () => [],
    cleanup: () => {},
    hostErrors: () => ({}),
    sessionExists: (t: string) => status.has(t),
    getStatus: async (t: string) => status.get(t) ?? "dead",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => "❯ ",
  },
}));
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async (_host: string, command: string) => {
    killed.push(command);
    return { stdout: "", stderr: "" };
  },
}));
vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  stopChat: (id: string) => killed.push(`chat ${id}`),
  chatState: () => null,
}));
vi.mock("@/lib/lumifyhub/task-cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lumifyhub/task-cards")>()),
  syncTaskCardInBackground: (s: { id: string }, state: TaskState) =>
    cards.push([s.id, state]),
}));
vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  isAgentOSWorktree: (p: string) => p.includes(WORKTREE_MARK),
}));

vi.mock("@/lib/project-config/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-config/database")>()),
  dropSessionDatabase: async (id: string) => {
    droppedDatabases.push(id);
  },
}));

// Orchestrators' scratch folders go in a temporary home.
vi.spyOn(os, "homedir").mockReturnValue(
  fs.mkdtempSync(path.join(os.tmpdir(), "aos-done-home-"))
);

const { db } = await import("@/lib/db");
const { createProject } = await import("@/lib/projects");
const { createWorkspace, setProjectWorkspace } =
  await import("@/lib/workspaces");
const { ensureOrchestrator } = await import("@/lib/orchestrator/home");
const { putCheck } = await import("@/lib/orchestrator/checks");
const { failureOf } = await import("@/lib/orchestrator/gates");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { doneSession } = await import("./index");
const { signOffTask } = await import("@/lib/tasks");
const { deleteWorktree } = await import("@/lib/worktrees");
const { worktreeFate } = await import("./worktree");
const { setGlobalMergeSettings, setProjectMergeSettings } =
  await import("@/lib/tasks/merge-policy");

beforeEach(() => {
  setGlobalMergeSettings({});
  ghDown = false;
  merges.length = 0;
  killed.length = 0;
  cards.length = 0;
  droppedDatabases.length = 0;
});

const row = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as {
    task_status: string | null;
    archived_at: string | null;
    name: string;
    tmux_name: string;
  };

// A workspace project on a real clone, and sessions in it.
function setup() {
  const r = makeRepo();
  const workspace = createWorkspace(
    `ws-${path.basename(r.repo)}-${merges.length}`
  );
  const project = createProject({
    name: `app-${Math.random().toString(36).slice(2, 8)}`,
    workingDirectory: r.repo,
  });
  setProjectWorkspace(project.id, workspace.id);
  ensureOrchestrator(workspace.id);
  const w = workspace.id;

  function session(
    name: string,
    opts: {
      task?: boolean;
      commits?: Record<string, string>;
      worktree?: boolean;
      live?: "running" | "idle";
    } = {}
  ) {
    const branch = `feature/${name}`;
    const wt =
      opts.worktree === false ? null : r.worktree(branch, opts.commits);
    const id = seedSession({
      projectId: project.id,
      name,
      task: opts.task,
      branch: wt ? branch : undefined,
    });
    db.prepare(
      `UPDATE sessions SET worktree_path = ?, working_directory = ?, base_branch = 'main' WHERE id = ?`
    ).run(wt?.dir ?? null, wt?.dir ?? r.repo, id);
    if (opts.live) status.set(row(id).tmux_name, opts.live);
    return { id, branch, dir: wt?.dir ?? null, head: wt?.head ?? null };
  }

  // An open PR on the session's branch at its head, CI green and settled.
  function openPR(
    s: { id: string; branch: string; head: string | null },
    over: Partial<TaskPR> = {},
    reviewed = true
  ) {
    const pr: TaskPR = {
      number: 100 + prs.size,
      url: `https://github.com/o/r/pull/${100 + prs.size}`,
      state: "OPEN",
      checks: "pass",
      head: s.head!,
      failing: null,
      checkCount: 1,
      // The task's /do-code-review of its head, in the PR body.
      codeReview: { sha: s.head! },
      ...over,
    };
    prs.set(s.branch, pr);
    const at = { workspaceId: w, sessionId: s.id, sha: s.head! };
    putCheck({
      ...at,
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: 1, at: 0 }),
    });
    if (reviewed) putCheck({ ...at, kind: "review", status: "pass" });
    return pr;
  }

  return { w, project, repo: r.repo, session, openPR };
}

describe("done, by state", () => {
  it("(a) refuses an open PR whose body has no code review of its head", async () => {
    const t = setup();
    const s = t.session("unreviewed", {
      task: true,
      commits: { "src/a.ts": "export const a = 1;\n" },
      live: "idle",
    });
    t.openPR(s, { codeReview: null });
    await expect(doneSession(s.id, { by: "direct" })).rejects.toThrow(
      /Not done, nothing merged[\s\S]*no Code review section/
    );
    expect(merges).toEqual([]);
  });

  it("(a) merges an open PR that passes the gates, pinned to its head, then cleans up", async () => {
    const t = setup();
    const s = t.session("ship", {
      task: true,
      commits: { "src/a.ts": "export const a = 1;\n" },
      live: "idle",
    });
    t.openPR(s);
    const out = await doneSession(s.id, { by: "direct" });
    expect(merges).toHaveLength(1);
    expect(merges[0]).toEqual(
      expect.arrayContaining([
        "merge",
        "--squash",
        "--match-head-commit",
        s.head!,
      ])
    );
    expect(out.merged).toMatch(/Merged ship/);
    expect(out.worktree).toMatchObject({ action: "removed" });
    expect(fs.existsSync(s.dir!)).toBe(false);
    expect(row(s.id)).toMatchObject({ task_status: "merged" });
    expect(row(s.id).archived_at).not.toBeNull();
    expect(cards).toContainEqual([s.id, "merged"]);
    // Its private database goes with it.
    expect(droppedDatabases).toContain(s.id);
  });

  it("(a) refuses on a failing gate, naming it, and merges nothing", async () => {
    const t = setup();
    const s = t.session("red", {
      task: true,
      commits: { "src/b.ts": "export const b = 1;\n" },
      live: "idle",
    });
    t.openPR(s, { checks: "fail", failing: "test" });
    await expect(doneSession(s.id, { by: "direct" })).rejects.toThrow(
      /Not done, nothing merged[\s\S]*\n- ci failed: CI failed/
    );
    // A person's done doesn't count toward sending it to Saad.
    expect(failureOf(s.id, "ci")).toBeNull();
    expect(merges).toEqual([]);
    expect(droppedDatabases).toEqual([]);
    expect(fs.existsSync(s.dir!)).toBe(true);
    expect(row(s.id)).toMatchObject({
      task_status: "running",
      archived_at: null,
    });
    expect(killed).toEqual([]);
  });

  it("(a) refuses with no review of the head yet", async () => {
    const t = setup();
    const s = t.session("unreviewed", {
      task: true,
      commits: { "src/c.ts": "export const c = 1;\n" },
      live: "idle",
    });
    t.openPR(s, {}, false);
    await expect(doneSession(s.id, { by: "direct" })).rejects.toThrow(
      /review: not yet, no review of/
    );
    expect(merges).toEqual([]);
  });

  it("(b) cleans up a task whose PR is already merged", async () => {
    const t = setup();
    const s = t.session("landed", {
      task: true,
      commits: { "src/d.ts": "export const d = 1;\n" },
    });
    t.openPR(s, { state: "MERGED" });
    const out = await doneSession(s.id, { by: "direct" });
    expect(merges).toEqual([]);
    expect(out.worktree).toMatchObject({
      action: "removed",
      why: "its branch is merged",
    });
    expect(row(s.id)).toMatchObject({ task_status: "merged" });
    expect(row(s.id).archived_at).not.toBeNull();
    expect(killed.some((k) => k.includes("tmux kill-session"))).toBe(true);
    // Origin's branch was exactly what merged, so it goes too.
    expect(out.text).toContain("its merged branch deleted on origin");
    expect(git(t.repo, "ls-remote", "--heads", "origin", s.branch)).toBe("");
  });

  it("(b) keeps origin's branch when it moved past what merged", async () => {
    const t = setup();
    const s = t.session("moved", {
      task: true,
      commits: { "m.ts": "1\n", "n.ts": "2\n" },
    });
    const first = git(s.dir!, "rev-parse", "HEAD~1");
    t.openPR({ ...s, head: first }, { state: "MERGED" });
    const out = await doneSession(s.id, { by: "direct" });
    expect(out.text).not.toContain("deleted on origin");
    expect(git(t.repo, "ls-remote", "--heads", "origin", s.branch)).not.toBe(
      ""
    );
    // Its last commit is on origin, so the worktree loses nothing.
    expect(out.worktree).toMatchObject({ action: "removed" });
  });

  it("merged never removes uncommitted work or commits that weren't in the PR", async () => {
    const t = setup();
    const dirty = t.session("merged-dirty", {
      task: true,
      commits: { "p.ts": "1\n" },
    });
    t.openPR(dirty, { state: "MERGED" });
    fs.writeFileSync(path.join(dirty.dir!, "scratch.txt"), "unsaved\n");
    const a = await doneSession(dirty.id, { by: "direct" });
    expect(a.worktree).toMatchObject({
      action: "kept",
      why: "it has uncommitted changes (1 file: scratch.txt)",
    });
    expect(fs.existsSync(path.join(dirty.dir!, "scratch.txt"))).toBe(true);

    const extra = t.session("merged-extra", {
      task: true,
      commits: { "q.ts": "1\n" },
    });
    t.openPR(extra, { state: "MERGED" });
    commitFile(extra.dir!, "local-only.ts", "2\n");
    const b = await doneSession(extra.id, { by: "direct" });
    expect(b.worktree).toMatchObject({
      action: "kept",
      why: "1 commit is on it that the merged PR didn't include and no remote has",
    });
    expect(git(t.repo, "branch", "--list", extra.branch)).not.toBe("");
  });

  it("(a) a sign-off keeps a worktree with uncommitted work", async () => {
    const t = setup();
    const s = t.session("ship-dirty", {
      task: true,
      commits: { "src/e.ts": "export const e = 1;\n" },
      live: "idle",
    });
    t.openPR(s);
    fs.writeFileSync(path.join(s.dir!, "notes.md"), "keep me\n");
    const out = await doneSession(s.id, { by: "direct" });
    expect(merges).toHaveLength(1);
    expect(out.worktree).toMatchObject({
      action: "kept",
      why: "it has uncommitted changes (1 file: notes.md)",
    });
    expect(fs.readFileSync(path.join(s.dir!, "notes.md"), "utf8")).toBe(
      "keep me\n"
    );
  });

  it("refuses when GitHub can't say whether a PR is open", async () => {
    const t = setup();
    const down = t.session("gh-down", { task: true });
    ghDown = true;
    await expect(doneSession(down.id, { by: "direct" })).rejects.toThrow(
      /couldn't be read from GitHub \(HTTP 502/
    );
    ghDown = false;
    const lost = t.session("pr-lost", { task: true });
    db.prepare(`UPDATE sessions SET pr_number = 41 WHERE id = ?`).run(lost.id);
    await expect(doneSession(lost.id, { by: "direct" })).rejects.toThrow(
      /had PR #41 but GitHub doesn't return it now/
    );
    for (const id of [down.id, lost.id])
      expect(row(id)).toMatchObject({
        task_status: "running",
        archived_at: null,
      });
    expect(cards).toEqual([]);
  });

  it("(c) a plain session with no commits of its own loses its worktree", async () => {
    const t = setup();
    const s = t.session("chatty");
    const out = await doneSession(s.id, { by: "direct" });
    expect(out.worktree).toEqual({
      action: "removed",
      why: "its branch has no commits of its own",
    });
    expect(fs.existsSync(s.dir!)).toBe(false);
    expect(killed).toContain(`chat ${s.id}`);
    expect(row(s.id).task_status).toBeNull();
    expect(row(s.id).archived_at).not.toBeNull();
  });

  it("(c) keeps a worktree with unmerged commits or uncommitted changes, and says so", async () => {
    const t = setup();
    const a = t.session("wip", { commits: { "x.ts": "1\n", "y.ts": "2\n" } });
    const outA = await doneSession(a.id, { by: "direct" });
    expect(outA.worktree).toMatchObject({
      action: "kept",
      why: "its branch has 2 commits not merged into main",
    });
    expect(outA.text).toContain(`worktree kept at ${a.dir}`);
    expect(fs.existsSync(a.dir!)).toBe(true);
    expect(row(a.id).archived_at).not.toBeNull();

    const b = t.session("dirty");
    fs.writeFileSync(path.join(b.dir!, "notes.txt"), "unsaved\n");
    const outB = await doneSession(b.id, { by: "direct" });
    expect(outB.worktree).toMatchObject({
      action: "kept",
      why: "it has uncommitted changes (1 file: notes.txt)",
    });
  });

  it("files setup copied don't keep a worktree; an edit to one does", async () => {
    const t = setup();
    fs.writeFileSync(path.join(t.repo, ".env.local"), "KEY=1\n");
    const a = t.session("setup-only");
    fs.copyFileSync(
      path.join(t.repo, ".env.local"),
      path.join(a.dir!, ".env.local")
    );
    await recordPlaced(a.dir!, t.repo, [".env.local"]);
    const outA = await doneSession(a.id, { by: "direct" });
    expect(outA.worktree).toMatchObject({ action: "removed" });
    expect(fs.existsSync(a.dir!)).toBe(false);

    const b = t.session("setup-edited");
    fs.copyFileSync(
      path.join(t.repo, ".env.local"),
      path.join(b.dir!, ".env.local")
    );
    await recordPlaced(b.dir!, t.repo, [".env.local"]);
    fs.writeFileSync(path.join(b.dir!, ".env.local"), "KEY=2\n");
    const outB = await doneSession(b.id, { by: "direct" });
    expect(outB.worktree).toMatchObject({
      action: "kept",
      why: "it has uncommitted changes (1 file: .env.local)",
    });
  });

  it("keeps a worktree whose changes can't be read", async () => {
    const t = setup();
    const s = t.session("unreadable");
    // repoOf still answers; reading the status is what fails.
    const index = git(s.dir!, "rev-parse", "--git-path", "index").trim();
    fs.writeFileSync(path.resolve(s.dir!, index), "not an index");
    const out = await doneSession(s.id, { by: "direct" });
    expect(out.worktree).toMatchObject({
      action: "kept",
      why: "its uncommitted changes can't be checked",
    });
    expect(fs.existsSync(s.dir!)).toBe(true);
  });

  it("(c) a task with no PR ends as done, not dropped, and its card moves to Done", async () => {
    const t = setup();
    const s = t.session("answered", { task: true });
    await doneSession(s.id, { by: "direct" });
    expect(row(s.id).task_status).toBe("done");
    expect(cards).toEqual([[s.id, "done"]]);
  });

  it("refuses a session that's working, itself, or an orchestrator", async () => {
    const t = setup();
    const busy = t.session("busy", { live: "running" });
    await expect(doneSession(busy.id, { by: "direct" })).rejects.toThrow(
      /still working/
    );
    const me = t.session("me", { worktree: false });
    await expect(
      doneSession(me.id, { by: "direct", callerId: me.id })
    ).rejects.toThrow(/can't mark itself done/);
    const orch = ensureOrchestrator(t.w);
    await expect(doneSession(orch.id, { by: "direct" })).rejects.toThrow(
      /orchestrator/
    );
    expect(row(busy.id).archived_at).toBeNull();
  });
});

const { GET: listSessions } = await import("@/app/api/sessions/route");
const { sessionFacts } = await import("@/lib/orchestrator/facts");
const { runTool } = await import("@/lib/orchestrator/serve");
const { setPaused } = await import("@/lib/orchestrator/pause");
const { listPeers, resolveSession } = await import("@/lib/bus");
const { listArchived, unarchiveSession } = await import("./archive");
const { doneIdle, previewIdle, scopeOf } = await import("./bulk");
const { POST: busDone } = await import("@/app/api/bus/done/route");
const { GET: statusGET } = await import("@/app/api/sessions/status/route");
const { NextRequest } = await import("next/server");
const { getDoneTarget } = await import("./index");
const { saveItem } = await import("@/lib/chat/store");

const sidebarIds = async () =>
  (
    (await (await listSessions()).json()) as { sessions: { id: string }[] }
  ).sessions.map((s) => s.id);

// Enough files that `git worktree remove` is still deleting when the next
// step reads the tree, as it is with a real checkout and its dependencies.
function bulkCommit(dir: string, branch: string): string {
  for (let i = 0; i < 1500; i++) {
    const d = path.join(dir, "bulk", String(i % 30));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `f${i}.ts`), `export const v = ${i};\n`);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "bulk");
  git(dir, "push", "-q", "origin", branch);
  return git(dir, "rev-parse", "HEAD");
}

describe("done right after a sign-off", () => {
  it("waits for the sign-off's cleanup instead of reading a half-deleted tree", async () => {
    const t = setup();
    const s = t.session("signed-clean", { task: true });
    s.head = bulkCommit(s.dir!, s.branch);
    t.openPR(s);
    let release = () => {};
    cleanupGate = new Promise((r) => (release = r));
    try {
      await signOffTask(s.id);
      let finished = false;
      const done = doneSession(s.id, { by: "direct" }).finally(
        () => (finished = true)
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(finished).toBe(false);
      expect(fs.existsSync(s.dir!)).toBe(true);
      release();
      const out = await done;
      expect(out.worktree).toMatchObject({
        action: "removed",
        why: "its branch is merged",
      });
      expect(fs.existsSync(s.dir!)).toBe(false);
    } finally {
      cleanupGate = null;
      release();
    }
  });

  it("keeps uncommitted work through the sign-off's cleanup and done", async () => {
    const t = setup();
    const s = t.session("signed-dirty", { task: true });
    s.head = bulkCommit(s.dir!, s.branch);
    t.openPR(s);
    fs.writeFileSync(path.join(s.dir!, "notes.md"), "keep me\n");
    await signOffTask(s.id);
    const out = await doneSession(s.id, { by: "direct" });
    expect(out.worktree).toMatchObject({
      action: "kept",
      why: "it has uncommitted changes (1 file: notes.md)",
    });
    const again = await worktreeFate(
      { worktree_path: s.dir, base_branch: "main" },
      { prHead: s.head }
    );
    expect(again).toMatchObject({ action: "kept" });
    expect(fs.readFileSync(path.join(s.dir!, "notes.md"), "utf8")).toBe(
      "keep me\n"
    );
  });

  it("judges a worktree only after a removal already running ends", async () => {
    const t = setup();
    const s = t.session("removing", { task: true });
    bulkCommit(s.dir!, s.branch);
    const removal = deleteWorktree(s.dir!, t.repo, true);
    const fate = await worktreeFate(
      { worktree_path: s.dir, base_branch: "main" },
      null
    );
    await removal;
    expect(fate).toEqual({ action: "none" });
  });

  it("judges again when a removal starts while it reads", async () => {
    const t = setup();
    const s = t.session("starts-removing", { task: true });
    bulkCommit(s.dir!, s.branch);
    const reading = worktreeFate(
      { worktree_path: s.dir, base_branch: "main" },
      null
    );
    const removal = new Promise<void>((resolve, reject) =>
      queueMicrotask(() =>
        deleteWorktree(s.dir!, t.repo, true).then(resolve, reject)
      )
    );
    const fate = await reading;
    await removal;
    expect(fate).toEqual({ action: "none" });
  });

  it("joins a running removal, and a join that asks still deletes the branch", async () => {
    const t = setup();
    const s = t.session("joined", { task: true });
    bulkCommit(s.dir!, s.branch);
    const first = deleteWorktree(s.dir!, t.repo, false);
    const second = deleteWorktree(s.dir!, t.repo, true);
    expect(deleteWorktree(s.dir!, t.repo, false)).toBe(first);
    await Promise.all([first, second]);
    expect(fs.existsSync(s.dir!)).toBe(false);
    expect(git(t.repo, "branch", "--list", s.branch)).toBe("");
  });
});

describe("archived sessions", () => {
  it("are hidden from the sidebar, the orchestrator and peers, never deleted, and come back on unarchive", async () => {
    const t = setup();
    const s = t.session("finished", { worktree: false });
    saveItem(s.id, { id: "u1", kind: "user", text: "hi", createdAt: 1 });
    expect(await sidebarIds()).toContain(s.id);

    await doneSession(s.id, { by: "direct" });
    // The needs-you pill counts the sidebar's sessions.
    expect(await sidebarIds()).not.toContain(s.id);
    expect((await sessionFacts(t.w)).map((f) => f.id)).not.toContain(s.id);
    await expect(runTool(t.w, "read", { session: "finished" })).rejects.toThrow(
      /No session "finished"/
    );
    expect((await listPeers()).map((p) => p.id)).not.toContain(s.id);
    expect(() => resolveSession(s.id)).toThrow(/No session/);
    expect(listArchived(t.w).map((a) => a.id)).toEqual([s.id]);
    expect(
      db
        .prepare(`SELECT COUNT(*) AS n FROM chat_items WHERE session_id = ?`)
        .get(s.id)
    ).toEqual({ n: 1 });

    unarchiveSession(s.id);
    expect(await sidebarIds()).toContain(s.id);
    expect((await sessionFacts(t.w)).map((f) => f.id)).toContain(s.id);
    expect(listArchived(t.w)).toEqual([]);
    expect(() => unarchiveSession(s.id)).toThrow(/isn't archived/);
  });
});

describe("done --all-idle", () => {
  it("previews, then cleans up every idle or stopped session, and never merges", async () => {
    const t = setup();
    const caller = t.session("caller", { worktree: false, live: "running" });
    const busy = t.session("busy", { worktree: false, live: "running" });
    const idle = t.session("idle", { live: "idle" });
    const stopped = t.session("stopped", { commits: { "z.ts": "z\n" } });
    const green = t.session("green", {
      task: true,
      commits: { "g.ts": "g\n" },
      live: "idle",
    });
    t.openPR(green);
    const lost = t.session("lost", { task: true });
    db.prepare(`UPDATE sessions SET pr_number = 9 WHERE id = ?`).run(lost.id);
    const scope = scopeOf(getDoneTarget(caller.id));

    const preview = await previewIdle(scope, caller.id);
    const by = Object.fromEntries(preview.map((r) => [r.name, r]));
    expect(Object.keys(by).sort()).toEqual([
      "green",
      "idle",
      "lost",
      "stopped",
    ]);
    expect(by.idle).toMatchObject({ action: "cleanup", removesWorktree: true });
    expect(by.stopped.line).toMatch(
      /keep its worktree: its branch has 1 commit/
    );
    expect(by.green).toMatchObject({ action: "merge" });
    expect(by.lost).toMatchObject({ action: "refuse" });
    // A preview changes nothing.
    expect(fs.existsSync(idle.dir!)).toBe(true);
    expect(row(idle.id).archived_at).toBeNull();

    const r = await doneIdle(scope, { by: "direct", callerId: caller.id });
    expect(r.done.map((d) => d.name).sort()).toEqual(["idle", "stopped"]);
    expect(r.mergeable).toEqual([
      { id: green.id, name: "green", pr: prs.get(green.branch)!.number },
    ]);
    expect(r.refused.map((x) => x.name)).toEqual(["lost"]);
    expect(r.summary).toMatch(
      /^Done: 2, kept a worktree: 1, refused: 1, open PRs left for their own done: 1\./
    );
    expect(merges).toEqual([]);
    for (const id of [caller.id, busy.id, green.id, lost.id])
      expect(row(id).archived_at).toBeNull();
    expect(fs.existsSync(stopped.dir!)).toBe(true);
    expect(fs.existsSync(idle.dir!)).toBe(false);
  });
});

describe("aos done", () => {
  const call = (body: object) =>
    busDone(
      new NextRequest("http://x/api/bus/done", {
        method: "POST",
        body: JSON.stringify(body),
      })
    ).then(async (r) => ({ status: r.status, body: await r.json() }));

  it("reaches only the caller's workspace, and only from a session", async () => {
    const t = setup();
    const other = setup();
    const me = t.session("me-bus", { worktree: false, live: "running" });
    const mine = t.session("mine-bus", { worktree: false });
    const theirs = other.session("theirs-bus", { worktree: false });

    const out = await call({ from: me.id, session: theirs.id });
    expect(out.status).toBe(409);
    expect(out.body.error).toMatch(/isn't in me-bus's workspace/);
    expect(row(theirs.id).archived_at).toBeNull();

    expect((await call({ session: mine.id })).body.error).toMatch(
      /from inside an AgentOS session/
    );
    const ok = await call({ from: me.id, session: mine.id });
    expect(ok.status).toBe(200);
    expect(row(mine.id).archived_at).not.toBeNull();
  });
});

describe("status", () => {
  it("leaves archived chats out", async () => {
    const t = setup();
    const chat = t.session("chat-status", { worktree: false });
    db.prepare(`UPDATE sessions SET view = 'chat' WHERE id = ?`).run(chat.id);
    const ids = async () =>
      Object.keys(
        ((await (await statusGET()).json()) as { statuses: object }).statuses
      );
    expect(await ids()).toContain(chat.id);
    await doneSession(chat.id, { by: "direct" });
    expect(await ids()).not.toContain(chat.id);
  });
});

describe("the orchestrator's done tool", () => {
  it("acts only in its workspace, counts gate failures, and refuses while paused", async () => {
    const t = setup();
    const other = setup();
    const theirs = other.session("theirs", { worktree: false });
    await expect(runTool(t.w, "done", { session: theirs.id })).rejects.toThrow(
      /No session/
    );
    expect(row(theirs.id).archived_at).toBeNull();

    const red = t.session("red-o", {
      task: true,
      commits: { "q.ts": "q\n" },
      live: "idle",
    });
    t.openPR(red, { checks: "fail" });
    await expect(runTool(t.w, "done", { session: "red-o" })).rejects.toThrow(
      /ci failed \(first\)/
    );
    expect(failureOf(red.id, "ci")?.count).toBe(1);

    t.session("mine", { worktree: false });
    setPaused(t.w, true);
    await expect(runTool(t.w, "done", { session: "mine" })).rejects.toThrow(
      /Paused/
    );
    setPaused(t.w, false);
    expect(await runTool(t.w, "done", { session: "mine" })).toMatch(
      /^Done: mine\. Agent stopped, no worktree; archived\.$/
    );
  });
});

describe("merge settings", () => {
  it("merges with the project's method, which beats the global one", async () => {
    const t = setup();
    setGlobalMergeSettings({ method: "merge" });
    setProjectMergeSettings(t.project.id, { method: "rebase" });
    const s = t.session("rebased", {
      task: true,
      commits: { "src/r.ts": "export const r = 1;\n" },
      live: "idle",
    });
    t.openPR(s);
    const out = await doneSession(s.id, { by: "direct" });
    expect(merges).toEqual([
      expect.arrayContaining(["merge", "--rebase", "--match-head-commit"]),
    ]);
    expect(merges[0]).not.toContain("--squash");
    expect(out.merged).toMatch(/rebase-merged/);
  });

  it("uses the global method when the project sets none", async () => {
    const t = setup();
    setGlobalMergeSettings({ method: "merge" });
    const s = t.session("merge-commit", {
      task: true,
      commits: { "src/m.ts": "export const m = 1;\n" },
      live: "idle",
    });
    t.openPR(s);
    const out = await doneSession(s.id, { by: "direct" });
    expect(merges[0]).toEqual(expect.arrayContaining(["--merge"]));
    expect(out.merged).toMatch(/merged with a merge commit/);
  });

  it("keeps origin's branch and the worktree after a sign-off when both deletions are off", async () => {
    const t = setup();
    setProjectMergeSettings(t.project.id, {
      delete_remote_branch: false,
      delete_worktree: false,
    });
    const s = t.session("kept", {
      task: true,
      commits: { "src/k.ts": "export const k = 1;\n" },
      live: "idle",
    });
    t.openPR(s);
    const out = await doneSession(s.id, { by: "direct" });
    expect(merges[0]).toEqual(expect.arrayContaining(["--squash"]));
    expect(out.worktree).toMatchObject({
      action: "kept",
      why: "the merge settings keep worktrees after a merge",
    });
    expect(fs.existsSync(s.dir!)).toBe(true);
    expect(git(t.repo, "branch", "--list", s.branch)).not.toBe("");
    expect(git(t.repo, "ls-remote", "--heads", "origin", s.branch)).not.toBe(
      ""
    );
    expect(row(s.id).archived_at).not.toBeNull();
  });

  it("toggles each deletion on its own for a PR merged on GitHub", async () => {
    const t = setup();
    // Global: keep origin's branch; the project still removes its worktree.
    setGlobalMergeSettings({ delete_remote_branch: false });
    const s = t.session("half", {
      task: true,
      commits: { "src/h.ts": "export const h = 1;\n" },
    });
    t.openPR(s, { state: "MERGED" });
    const out = await doneSession(s.id, { by: "direct" });
    expect(out.text).not.toContain("deleted on origin");
    expect(git(t.repo, "ls-remote", "--heads", "origin", s.branch)).not.toBe(
      ""
    );
    expect(out.worktree).toMatchObject({ action: "removed" });

    setGlobalMergeSettings({ delete_worktree: false });
    const k = t.session("half-kept", {
      task: true,
      commits: { "src/i.ts": "export const i = 1;\n" },
    });
    t.openPR(k, { state: "MERGED" });
    const kept = await doneSession(k.id, { by: "direct" });
    expect(kept.text).toContain("its merged branch deleted on origin");
    expect(kept.worktree).toMatchObject({ action: "kept" });
    expect(fs.existsSync(k.dir!)).toBe(true);
  });

  it("still never removes uncommitted work when deletion is on", async () => {
    const t = setup();
    setProjectMergeSettings(t.project.id, { delete_worktree: true });
    const s = t.session("dirty", {
      task: true,
      commits: { "src/u.ts": "export const u = 1;\n" },
    });
    t.openPR(s, { state: "MERGED" });
    fs.writeFileSync(path.join(s.dir!, "scratch.txt"), "wip");
    const out = await doneSession(s.id, { by: "direct" });
    expect(out.worktree).toMatchObject({ action: "kept" });
    expect(fs.existsSync(s.dir!)).toBe(true);
  });
});
