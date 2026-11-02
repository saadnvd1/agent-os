import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { tempDir } from "@/lib/test-temp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitFile, git, makeRepo, WORKTREE_MARK } from "@/lib/done/testing";

vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  isAgentOSWorktree: (p: string) => p.includes(WORKTREE_MARK),
}));

const { db } = await import("@/lib/db");
const { createProject } = await import("@/lib/projects");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { setTask, updateSessionRow } = await import("@/lib/db/session-parts");
const { sweep } = await import("./runSweep");
const { noExtras } = await import("./extras");
const { setReaperArmed } = await import("./settings");
const { recentRuns, sweptAt } = await import("./store");
const { setGlobalSweepDays, setProjectSweepDays } = await import("./settings");
import type { SweepDeps } from "./runSweep";

const DAY = 24 * 3600_000;
const sqlTime = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const ago = (days: number) => sqlTime(Date.now() - days * DAY);

type Status = Awaited<ReturnType<SweepDeps["settled"]["status"]>>;
const IDLE: Status = { status: "idle", activity: null, needsInput: false };

function setup() {
  const r = makeRepo();
  const project = createProject({
    name: `app-${randomUUID().slice(0, 8)}`,
    workingDirectory: r.repo,
  });
  let status: Status = IDLE;
  let panes: string[] = [];
  let restoring = false;
  let busy = false;
  const trees = () => path.join(path.dirname(r.repo), WORKTREE_MARK);

  function session(
    opts: {
      days?: number;
      task?: "merged" | "dropped" | "done" | "running" | "moved" | null;
      commits?: Record<string, string>;
      archived?: boolean;
      prStatus?: string | null;
      pinned?: boolean;
    } = {}
  ) {
    const branch = `feature/s-${randomUUID().slice(0, 6)}`;
    const wt = r.worktree(branch, opts.commits);
    const id = seedSession({
      projectId: project.id,
      name: branch,
      task: true,
      branch,
      view: "chat",
    });
    const when = ago(opts.days ?? 30);
    const task = opts.task === undefined ? "merged" : opts.task;
    setTask(db, id, {
      task_status: task,
      merged_at: task === "merged" ? when : null,
      task_ended_at: task && task !== "merged" ? when : null,
    });
    updateSessionRow(db, id, {
      worktree_path: wt.dir,
      working_directory: wt.dir,
      base_branch: "main",
      updated_at: when,
      archived_at: opts.archived ? when : null,
      pr_status: opts.prStatus ?? null,
      pinned: opts.pinned ? 1 : 0,
    });
    return { id, branch, dir: wt.dir };
  }

  const deps = (): SweepDeps => ({
    now: Date.now(),
    root: trees(),
    panes: async () => panes,
    settled: { status: async () => status, isRestoring: () => restoring },
    size: async () => 1000,
    prHead: async () => null,
    busy: () => busy,
    extras: noExtras,
    report: () => null,
  });
  return {
    r,
    project,
    session,
    deps,
    set: {
      status: (s: Status) => (status = s),
      panes: (p: string[]) => (panes = p),
      restoring: (b: boolean) => (restoring = b),
      busy: (b: boolean) => (busy = b),
    },
  };
}

beforeEach(() => {
  setGlobalSweepDays(null);
});

const run = async (t: ReturnType<typeof setup>) =>
  (await sweep({}, t.deps())).summary;
const reasonFor = (s: Awaited<ReturnType<typeof run>>, p: string) =>
  s.skipped.find((k) => k.path === p)?.reason;

describe("sweeping settled sessions", () => {
  it("removes an old merged worktree, keeps its branch, and records it", async () => {
    const t = setup();
    const s = t.session({ commits: { "a.txt": "a\n" } });
    const summary = await run(t);
    expect(summary.removed.map((x) => x.path)).toEqual([s.dir]);
    expect(summary.freedBytes).toBe(1000);
    expect(fs.existsSync(s.dir)).toBe(false);
    expect(git(t.r.repo, "rev-parse", "--verify", s.branch)).toBeTruthy();
    expect(git(t.r.repo, "worktree", "list")).not.toContain(s.dir);
    expect(sweptAt(s.id)).toBeTruthy();
    const last = recentRuns(1)[0];
    expect([last.removed, last.freedBytes, last.dryRun]).toEqual([
      1,
      1000,
      false,
    ]);
  });

  it("settled by drop, done or archive all count", async () => {
    const t = setup();
    const dirs = [
      t.session({ task: "dropped" }).dir,
      t.session({ task: "done" }).dir,
      t.session({ task: null, archived: true }).dir,
    ];
    const summary = await run(t);
    expect(summary.removed.map((x) => x.path).sort()).toEqual(dirs.sort());
  });

  it("never touches a running task, or a plain session that isn't archived", async () => {
    const t = setup();
    const running = t.session({ task: "running" });
    const plain = t.session({ task: null });
    const summary = await run(t);
    expect(summary.removed).toEqual([]);
    expect(summary.skipped).toEqual([]);
    expect(fs.existsSync(running.dir) && fs.existsSync(plain.dir)).toBe(true);
  });

  it("waits N days from when it settled", async () => {
    const t = setup();
    const young = t.session({ days: 3 });
    const old = t.session({ days: 8 });
    const summary = await run(t);
    expect(summary.removed.map((x) => x.path)).toEqual([old.dir]);
    expect(reasonFor(summary, young.dir)).toMatch(/less than 7 days/);
  });

  it("activity after it settled starts the wait again", async () => {
    const t = setup();
    const s = t.session({ days: 30 });
    db.prepare(`UPDATE sessions SET active_at = ? WHERE id = ?`).run(
      ago(1),
      s.id
    );
    const summary = await run(t);
    expect(summary.removed).toEqual([]);
    expect(reasonFor(summary, s.dir)).toMatch(/less than 7 days/);
  });

  it("a global number and a project's own number change the wait; 0 is off", async () => {
    const t = setup();
    const s = t.session({ days: 3 });
    setGlobalSweepDays(2);
    expect((await run(t)).removed.map((x) => x.path)).toEqual([s.dir]);

    const a = t.session({ days: 30 });
    setGlobalSweepDays(0);
    const off = await run(t);
    expect(off.removed).toEqual([]);
    expect(reasonFor(off, a.dir)).toMatch(/off for its project/);

    setGlobalSweepDays(7);
    setProjectSweepDays(t.project.id, 0);
    expect((await run(t)).removed).toEqual([]);
    setProjectSweepDays(t.project.id, 1);
    expect((await run(t)).removed.map((x) => x.path)).toEqual([a.dir]);
    setProjectSweepDays(t.project.id, null);
  });

  it("leaves a task that moved to another machine alone, and a settled one that did once", async () => {
    const t = setup();
    const moved = t.session({ task: "moved" });
    const back = t.session();
    db.prepare(
      `UPDATE session_tasks SET moved_to = 'x' WHERE session_id = ?`
    ).run(back.id);
    const summary = await run(t);
    expect(summary.removed).toEqual([]);
    expect(reasonFor(summary, back.dir)).toMatch(/moved/);
    expect(fs.existsSync(moved.dir) && fs.existsSync(back.dir)).toBe(true);
  });

  it("skips an open PR, a pinned session and one that is being restored", async () => {
    const t = setup();
    const open = t.session({ prStatus: "open" });
    const pinned = t.session({ pinned: true });
    const restoring = t.session();
    t.set.restoring(true);
    const summary = await run(t);
    expect(reasonFor(summary, open.dir)).toMatch(/PR is open/);
    expect(reasonFor(summary, pinned.dir)).toMatch(/pinned/);
    expect(reasonFor(summary, restoring.dir)).toMatch(/being restored/);
    expect(summary.removed).toEqual([]);
    t.set.restoring(false);
  });

  it("skips one with an ask waiting on the owner", async () => {
    const t = setup();
    const s = t.session();
    db.prepare(
      `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, detail, status)
       VALUES ('ws', ?, 'gate', 'review', '', 'open')`
    ).run(`task:${s.id}`);
    const summary = await run(t);
    expect(reasonFor(summary, s.dir)).toMatch(/waiting on you/);
    db.prepare(
      `UPDATE orchestrator_asks SET status = 'resolved' WHERE subject = ?`
    ).run(`task:${s.id}`);
    expect((await run(t)).removed.map((x) => x.path)).toEqual([s.dir]);
  });

  it("skips one that is working, waiting for input, or has a terminal open", async () => {
    const t = setup();
    const s = t.session();
    t.set.status({ status: "running", activity: null, needsInput: false });
    expect(reasonFor(await run(t), s.dir)).toMatch(/running/);
    t.set.status({ status: "waiting", activity: null, needsInput: true });
    expect(reasonFor(await run(t), s.dir)).toMatch(/waiting on input/);
    t.set.status(IDLE);
    t.set.panes([path.join(fs.realpathSync(s.dir), "src")]);
    expect(reasonFor(await run(t), s.dir)).toMatch(/terminal is open/);
    expect(fs.existsSync(s.dir)).toBe(true);
  });

  it("skips one on another machine's row", async () => {
    const t = setup();
    const s = t.session();
    db.prepare(`UPDATE sessions SET host_id = 'other-box' WHERE id = ?`).run(
      s.id
    );
    const summary = await run(t);
    expect(summary.removed).toEqual([]);
    expect(fs.existsSync(s.dir)).toBe(true);
  });

  it("skips one with uncommitted changes, and says which", async () => {
    const t = setup();
    const s = t.session();
    fs.writeFileSync(path.join(s.dir, "wip.txt"), "x\n");
    const summary = await run(t);
    expect(reasonFor(summary, s.dir)).toMatch(
      /uncommitted changes \(1 file: wip\.txt\)/
    );
    expect(fs.existsSync(s.dir)).toBe(true);
    expect(sweptAt(s.id)).toBeNull();
  });

  it("skips one with a commit no remote or merged PR has", async () => {
    const t = setup();
    const s = t.session();
    commitFile(s.dir, "local.txt", "x\n");
    const summary = await run(t);
    expect(reasonFor(summary, s.dir)).toMatch(
      /1 commit no remote branch or merged PR has/
    );
    expect(fs.existsSync(s.dir)).toBe(true);
  });

  it("removes it once the merged PR's head holds the commit", async () => {
    const t = setup();
    const s = t.session();
    const head = commitFile(s.dir, "squashed.txt", "x\n");
    updateSessionRow(db, s.id, { pr_number: 5, pr_status: "merged" });
    const deps = { ...t.deps(), prHead: async () => head };
    const { summary } = await sweep({}, deps);
    expect(summary.removed.map((x) => x.path)).toEqual([s.dir]);
  });

  it("removes a settled folder git can't read only when it holds nothing of anyone's", async () => {
    const t = setup();
    const empty = t.session();
    fs.rmSync(path.join(empty.dir, ".git"));
    for (const f of fs.readdirSync(empty.dir))
      fs.rmSync(path.join(empty.dir, f), { recursive: true });
    fs.mkdirSync(path.join(empty.dir, "node_modules"));
    const mine = t.session();
    fs.rmSync(path.join(mine.dir, ".git"));
    const summary = await run(t);
    expect(summary.removed.map((x) => x.path)).toEqual([empty.dir]);
    expect(reasonFor(summary, mine.dir)).toMatch(/isn't a git worktree/);
  });

  it("a dry run removes nothing but says what it would", async () => {
    const t = setup();
    const s = t.session();
    const { summary } = await sweep({ dryRun: true }, t.deps());
    expect(summary.removed.map((x) => x.path)).toEqual([s.dir]);
    expect(fs.existsSync(s.dir)).toBe(true);
    expect(recentRuns(1)[0].dryRun).toBe(true);
  });

  it("stops early when the machine is busy", async () => {
    const t = setup();
    const s = t.session();
    t.set.busy(true);
    const summary = await run(t);
    expect(summary.removed).toEqual([]);
    expect(reasonFor(summary, s.dir)).toMatch(/busy/);
    t.set.busy(false);
  });
});

describe("sweeping what tasks leave beside their worktrees", () => {
  const found = [
    { path: "app_aos_0123456789ab", kind: "database" as const, bytes: 40 },
    { path: "/spare/x-1", kind: "spare" as const, bytes: 60 },
  ];
  function withExtras() {
    const t = setup();
    const dropped: string[] = [];
    const reports: unknown[] = [];
    const deps = (): SweepDeps => ({
      ...t.deps(),
      extras: async () => ({
        candidates: found.map((c) => ({ ...c, why: "dead" })),
        skipped: [],
        drop: async (c) => (dropped.push(c.path), true),
        spares: { count: 3, bytes: 99 },
      }),
      report: (summary) => (reports.push(summary), "/r.md"),
    });
    return { dropped, reports, deps };
  }

  it("only lists them while the full clean-up is off", async () => {
    setReaperArmed(false);
    const x = withExtras();
    const { summary } = await sweep({}, x.deps());
    expect(x.dropped).toEqual([]);
    expect(summary.removed).toEqual([]);
    expect(summary.pending?.map((p) => [p.path, p.bytes])).toEqual([
      ["app_aos_0123456789ab", 40],
      ["/spare/x-1", 60],
    ]);
    expect(summary.armed).toBe(false);
  });

  it("removes them once it is on, and counts the bytes freed", async () => {
    setReaperArmed(true);
    const x = withExtras();
    const { summary } = await sweep({}, x.deps());
    setReaperArmed(false);
    expect(x.dropped).toEqual(["app_aos_0123456789ab", "/spare/x-1"]);
    expect(summary.freedBytes).toBe(100);
    expect(summary.totals).toMatchObject({
      databases: { count: 1, bytes: 40 },
      spares: { count: 3, bytes: 99 },
    });
  });

  it("a dry run removes none of it and writes its list", async () => {
    setReaperArmed(true);
    const x = withExtras();
    const { summary } = await sweep({ dryRun: true }, x.deps());
    setReaperArmed(false);
    expect(x.dropped).toEqual([]);
    expect(summary.removed).toHaveLength(2);
    expect(x.reports).toHaveLength(1);
    expect(summary.report).toBe("/r.md");
  });

  it("leaves them for the next run when the machine is busy", async () => {
    setReaperArmed(true);
    const x = withExtras();
    const { summary } = await sweep({}, { ...x.deps(), busy: () => true });
    setReaperArmed(false);
    expect(x.dropped).toEqual([]);
    expect(
      summary.skipped
        .filter((k) => k.kind === "database" || k.kind === "spare")
        .map((k) => k.reason)
    ).toEqual([
      "the machine is busy; left for the next run",
      "the machine is busy; left for the next run",
    ]);
  });

  it("removes old test temp folders once it is on, and nothing else in the temp folder", async () => {
    const { findCacheLeftovers } = await import("./caches");
    const { dropFolderIn } = await import("./extras");
    const root = path.join(tempDir("aos-sweep-own-"), "tmp");
    fs.mkdirSync(root);
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    const mk = (name: string, when = old) => {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      fs.utimesSync(dir, when, when);
      return dir;
    };
    const stale = mk("aos-orch-repo-stale");
    const fresh = mk("aos-orch-repo-fresh", new Date());
    const other = mk("somebody-elses-old");
    const review = mk("aos-review-old");
    const t = setup();
    const extras = async () => {
      const found = await findCacheLeftovers({
        now: Date.now(),
        spareRoot: "",
        tmpRoot: root,
        derivedRoot: "",
        worktreesRoot: "",
        liveIds: new Set(),
        workspaceOf: async () => null,
        size: async () => 7,
      });
      return {
        ...found,
        drop: (c: { path: string }) => dropFolderIn([root], c.path),
        spares: { count: 0, bytes: 0 },
      };
    };
    const run = (armed: boolean, dryRun = false) => {
      setReaperArmed(armed);
      return sweep({ dryRun }, { ...t.deps(), extras });
    };
    try {
      const off = await run(false);
      expect(off.summary.pending?.map((p) => p.path)).toEqual([stale]);
      expect(fs.existsSync(stale)).toBe(true);
      await run(true, true);
      expect(fs.existsSync(stale)).toBe(true);
      const on = await run(true);
      expect(on.summary.removed.map((r) => [r.path, r.kind])).toEqual([
        [stale, "test-temp"],
      ]);
      expect(fs.existsSync(stale)).toBe(false);
      for (const kept of [fresh, other, review])
        expect(fs.existsSync(kept)).toBe(true);
    } finally {
      setReaperArmed(false);
    }
  });

  it("a person's own plain session is never a candidate for its worktree", async () => {
    const t = setup();
    const s = t.session({ task: null, commits: { "a.txt": "a\n" } });
    const { summary } = await sweep({}, t.deps());
    expect(summary.removed.map((r) => r.path)).not.toContain(s.dir);
    expect(fs.existsSync(s.dir)).toBe(true);
  });
});
