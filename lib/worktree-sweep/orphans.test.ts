import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { commitFile, git, makeRepo, WORKTREE_MARK } from "@/lib/done/testing";

vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  isAgentOSWorktree: (p: string) => p.includes(WORKTREE_MARK),
}));

const { sweep } = await import("./runSweep");
const { noExtras } = await import("./extras");
const { setGlobalSweepDays, setReaperArmed } = await import("./settings");
import type { SweepDeps } from "./runSweep";

const DAY = 24 * 3600_000;

function setup() {
  const r = makeRepo();
  const root = path.join(path.dirname(r.repo), WORKTREE_MARK);
  const age = (dir: string, days: number) => {
    const t = new Date(Date.now() - days * DAY);
    fs.utimesSync(dir, t, t);
    if (fs.existsSync(path.join(dir, ".git")))
      fs.utimesSync(path.join(dir, ".git"), t, t);
  };
  const deps = (): SweepDeps => ({
    now: Date.now(),
    root,
    panes: async () => [],
    settled: {
      status: async () => ({
        status: "idle",
        activity: null,
        needsInput: false,
      }),
      isRestoring: () => false,
    },
    size: async () => 10,
    prHead: async () => null,
    busy: () => false,
    extras: noExtras,
    report: () => null,
  });
  // A worktree no session row names.
  const orphan = (name: string, days = 30) => {
    const dir = path.join(root, name);
    git(r.repo, "worktree", "add", "-q", "-b", `feature/${name}`, dir, "main");
    age(dir, days);
    return dir;
  };
  const run = async () => (await sweep({}, deps())).summary;
  return { r, root, orphan, age, run };
}

const reasonFor = (
  s: Awaited<ReturnType<ReturnType<typeof setup>["run"]>>,
  p: string
) => s.skipped.find((k) => k.path === p)?.reason;

describe("sweeping orphan folders", () => {
  it("removes an old clean one and prunes its repository", async () => {
    setGlobalSweepDays(null);
    const t = setup();
    const dir = t.orphan("old");
    const s = await t.run();
    expect(s.removed.map((x) => [x.path, x.kind])).toEqual([[dir, "orphan"]]);
    expect(fs.existsSync(dir)).toBe(false);
    expect(git(t.r.repo, "worktree", "list")).not.toContain(dir);
    expect(git(t.r.repo, "rev-parse", "--verify", "feature/old")).toBeTruthy();
  });

  it("keeps a young one, a dirty one, one with unpushed commits", async () => {
    const t = setup();
    const young = t.orphan("young", 2);
    const dirty = t.orphan("dirty");
    fs.writeFileSync(path.join(dirty, "wip.txt"), "x\n");
    t.age(dirty, 30);
    const ahead = t.orphan("ahead");
    commitFile(ahead, "a.txt", "a\n");
    t.age(ahead, 30);
    const s = await t.run();
    expect(s.removed).toEqual([]);
    expect(reasonFor(s, young)).toMatch(/less than 7 days/);
    expect(reasonFor(s, dirty)).toMatch(/uncommitted/);
    expect(reasonFor(s, ahead)).toMatch(/1 commit/);
  });

  it("never treats a folder a session row names as an orphan", async () => {
    const { db } = await import("@/lib/db");
    const { seedSession } = await import("@/lib/orchestrator/testing");
    const { createProject } = await import("@/lib/projects");
    const t = setup();
    const dir = t.orphan("owned");
    const p = createProject({ name: "owner", workingDirectory: t.r.repo });
    const id = seedSession({ projectId: p.id, name: "owner" });
    db.prepare(`UPDATE sessions SET worktree_path = ? WHERE id = ?`).run(
      dir,
      id
    );
    const s = await t.run();
    expect(s.removed).toEqual([]);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("removes a test's leftover without looking inside, even with its repo gone", async () => {
    setReaperArmed(true);
    const t = setup();
    const live = t.orphan("aos-quick-repo-AbC123-other");
    const gone = t.orphan("repo-quick-fix-typo-0a1b");
    commitFile(gone, "x.txt", "x\n");
    t.age(gone, 30);
    fs.rmSync(t.r.repo, { recursive: true, force: true });
    const s = await t.run();
    expect(s.removed.map((x) => x.kind)).toEqual(["test-leak", "test-leak"]);
    expect(fs.existsSync(live) || fs.existsSync(gone)).toBe(false);
    setReaperArmed(false);
  });

  it("only lists test leftovers while the full clean-up is off", async () => {
    setReaperArmed(false);
    const t = setup();
    const gone = t.orphan("repo-quick-fix-typo-0a1b");
    fs.rmSync(t.r.repo, { recursive: true, force: true });
    const s = await t.run();
    expect(s.removed).toEqual([]);
    expect(s.pending?.map((x) => [x.kind, x.bytes])).toEqual([
      ["test-leak", 10],
    ]);
    expect(fs.existsSync(gone)).toBe(true);
  });

  it("a young leftover goes once its repository is gone, and not before", async () => {
    setReaperArmed(true);
    const t = setup();
    const young = t.orphan("repo-quick-young-0001", 0);
    let s = await t.run();
    expect(s.removed).toEqual([]);
    expect(reasonFor(s, young)).toMatch(/less than/);
    fs.rmSync(t.r.repo, { recursive: true, force: true });
    s = await t.run();
    expect(s.removed.map((x) => x.path)).toEqual([young]);
    setReaperArmed(false);
  });

  it("an unregistered folder goes only when it holds nothing git could check", async () => {
    const t = setup();
    const disposable = path.join(t.root, "only-deps");
    fs.mkdirSync(path.join(disposable, "node_modules", "x"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(disposable, ".env.local"),
      ["KEY", ["sk", "test", "x".repeat(16)].join("-")].join("=")
    );
    fs.writeFileSync(
      path.join(disposable, ".git"),
      "gitdir: /nowhere/.git/worktrees/x\n"
    );
    t.age(disposable, 30);
    const real = path.join(t.root, "has-files");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, "notes.md"), "mine\n");
    t.age(real, 30);
    const s = await t.run();
    expect(s.removed.map((x) => x.path)).toEqual([disposable]);
    expect(reasonFor(s, real)).toMatch(/holds files git can't check/);
    expect(fs.existsSync(path.join(real, "notes.md"))).toBe(true);
  });

  it("ignores markers, dotfiles and plain files in the folder", async () => {
    const t = setup();
    fs.mkdirSync(t.root, { recursive: true });
    fs.writeFileSync(path.join(t.root, ".x.removing"), "1");
    fs.writeFileSync(path.join(t.root, "build.log"), "log");
    fs.mkdirSync(path.join(t.root, ".hidden"));
    const s = await t.run();
    expect([s.removed, s.skipped]).toEqual([[], []]);
    expect(fs.existsSync(path.join(t.root, ".hidden"))).toBe(true);
  });

  it("is off when the number is 0", async () => {
    const t = setup();
    const dir = t.orphan("zero");
    setGlobalSweepDays(0);
    const s = await t.run();
    setGlobalSweepDays(null);
    expect(s.removed).toEqual([]);
    expect(fs.existsSync(dir)).toBe(true);
  });
});
