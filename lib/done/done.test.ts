import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPR, TaskState } from "@/lib/tasks/state";
import { makeRepo, WORKTREE_MARK } from "./testing";

// Real repositories; gh, tmux, chat workers and LumifyHub are faked.
const prs = new Map<string, TaskPR>();
const merges: string[][] = [];
const killed: string[] = [];
const cards: [string, TaskState][] = [];
const status = new Map<string, "running" | "idle">();

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
      if (cmd === "tmux") throw new Error("no tmux in tests");
      return real.run(cmd, args, cwd, t);
    },
    findPR: async (_repo: string, branch: string) => prs.get(branch) ?? null,
  };
});
vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
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

beforeEach(() => {
  merges.length = 0;
  killed.length = 0;
  cards.length = 0;
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
      why: "it has uncommitted changes",
    });
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
const { doneIdle, scopeOf } = await import("./bulk");
const { getDoneTarget } = await import("./index");
const { saveItem } = await import("@/lib/chat/store");

const sidebarIds = async () =>
  (
    (await (await listSessions()).json()) as { sessions: { id: string }[] }
  ).sessions.map((s) => s.id);

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
  it("does every idle or stopped session in the workspace, keeps and refuses as each deserves", async () => {
    const t = setup();
    const caller = t.session("caller", { worktree: false, live: "running" });
    const busy = t.session("busy", { worktree: false, live: "running" });
    const idle = t.session("idle", { live: "idle" });
    const stopped = t.session("stopped", { commits: { "z.ts": "z\n" } });
    const red = t.session("red", {
      task: true,
      commits: { "r.ts": "r\n" },
      live: "idle",
    });
    t.openPR(red, { checks: "fail" });

    const r = await doneIdle(scopeOf(getDoneTarget(caller.id)), {
      by: "direct",
      callerId: caller.id,
    });
    expect(r.done.map((d) => d.name).sort()).toEqual(["idle", "stopped"]);
    expect(r.refused).toEqual([
      expect.objectContaining({
        name: "red",
        reason: expect.stringMatching(/ci failed/),
      }),
    ]);
    expect(r.summary).toMatch(/^Done: 2, kept a worktree: 1, refused: 1\./);
    expect(r.summary).toContain("refused  red:");
    expect(merges).toEqual([]);
    for (const id of [caller.id, busy.id, red.id])
      expect(row(id).archived_at).toBeNull();
    expect(fs.existsSync(stopped.dir!)).toBe(true);
    expect(fs.existsSync(idle.dir!)).toBe(false);
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
