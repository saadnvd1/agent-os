import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const WT_ROOT = vi.hoisted(
  () =>
    `${process.env.TMPDIR || "/tmp"}/aos-move-wt-${process.pid}-${Date.now()}`
);
vi.mock("../worktrees", async (orig) => ({
  ...(await orig<typeof import("../worktrees")>()),
  WORKTREES_DIR: WT_ROOT,
}));
vi.mock("../env-setup", () => ({ setupWorktree: vi.fn(async () => ({})) }));
vi.mock("../agents/launch", () => ({ launchClaude: vi.fn(async () => {}) }));

import { db } from "../db";
import { createHost } from "../hosts";
import { launchClaude } from "../agents/launch";
import { setupWorktree } from "../env-setup";
import { sessionPorts } from "../ports";
import { exportOrResume, exportTask, markMoved, resumeTask } from "./move";
import { importTask } from "./import";
import { claudeProjectDir } from "./transcript";
import {
  CLAUDE_ID,
  git,
  row,
  seedTask as seed,
  setupMoveRepo,
  type MoveFixture,
} from "./move-testing";

let f: MoveFixture;
const seedTask = (branch: string) => seed(f, WT_ROOT, branch);

beforeAll(() => {
  f = setupMoveRepo();
});
afterAll(() => {
  f.restore();
  fs.rmSync(WT_ROOT, { recursive: true, force: true });
});
beforeEach(() => vi.mocked(launchClaude).mockReset());

describe("leaving", () => {
  it("claims the task as moving, commits and pushes what was uncommitted, and hands over the conversation", async () => {
    const { id, cwd } = await seedTask("feature/export");
    const bundle = await exportTask(id, "box");
    expect(row(id)).toMatchObject({ task_status: "moving", moved_to: "box" });
    expect(git(cwd, "status", "--porcelain")).toBe("");
    git(f.repo, "fetch", "-q", "origin");
    expect(
      git(f.repo, "log", "-1", "--format=%s", "origin/feature/export")
    ).toBe("wip: moving to box");
    expect(git(f.repo, "show", "origin/feature/export:work.txt")).toBe(
      "half done"
    );
    expect(bundle).toMatchObject({
      moveId: id,
      branch: "feature/export",
      baseBranch: "main",
      prompt: "fix the thing",
      project: { path: "dev/app", name: "app" },
      claude: { sessionId: CLAUDE_ID, cwd },
    });
    expect(bundle.claude!.transcript).toContain(`${cwd}/work.txt`);
  });

  it("a second export of a task still moving repeats it; a moved one is refused", async () => {
    const { id } = await seedTask("feature/again");
    await exportTask(id, "box");
    await expect(exportTask(id, "box")).resolves.toMatchObject({ moveId: id });
    markMoved(id, "box");
    await expect(exportTask(id, "box")).rejects.toThrow(/already moved/);
  });

  it("pushes a branch whose pushed commits the agent rewrote, but never over someone else's push", async () => {
    const { id, cwd } = await seedTask("feature/amended");
    await exportTask(id, "box");
    markMoved(id, "box");
    db.prepare(
      `UPDATE sessions SET task_status = 'running', moved_to = NULL WHERE id = ?`
    ).run(id);
    // The agent folds the pushed wip commit into its own.
    git(cwd, "commit", "-q", "--amend", "-m", "feat: the real change");
    await expect(exportTask(id, "box")).resolves.toMatchObject({ moveId: id });
    git(f.repo, "fetch", "-q", "origin");
    expect(
      git(f.repo, "log", "-1", "--format=%s", "origin/feature/amended")
    ).toBe("feat: the real change");

    // Someone else pushes to it, and this machine fetches that without
    // taking it in (as a sign-off or restack fetch does).
    const other = path.join(f.tmp, "other-clone");
    git(f.tmp, "clone", "-q", "-b", "feature/amended", f.origin, other);
    fs.writeFileSync(path.join(other, "theirs.txt"), "x\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "theirs");
    git(other, "push", "-q", "origin", "feature/amended");
    git(f.repo, "fetch", "-q", "origin");
    db.prepare(
      `UPDATE sessions SET task_status = 'running', moved_to = NULL WHERE id = ?`
    ).run(id);
    git(cwd, "commit", "-q", "--amend", "-m", "feat: reworded again");
    await expect(exportTask(id, "box")).rejects.toThrow(/stale info|rejected/);
    git(f.repo, "fetch", "-q", "origin");
    expect(
      git(f.repo, "log", "-1", "--format=%s", "origin/feature/amended")
    ).toBe("theirs");
  });

  it("a failed export resumes the agent here", async () => {
    const { id, cwd } = await seedTask("feature/nopush");
    // Worktrees share the repo's config: put origin back for the next tests.
    git(cwd, "remote", "set-url", "origin", path.join(f.tmp, "missing.git"));
    try {
      await expect(exportOrResume(id, "box")).rejects.toThrow(
        /missing\.git|push/
      );
    } finally {
      git(cwd, "remote", "set-url", "origin", f.origin);
    }
    expect(row(id).task_status).toBe("running");
    expect(vi.mocked(launchClaude).mock.calls[0][0]).toMatchObject({
      sessionId: id,
      resume: CLAUDE_ID,
    });
  });

  it("a failed retry leaves it moving: an earlier try may have arrived", async () => {
    const { id, cwd } = await seedTask("feature/retry-fails");
    await exportTask(id, "box");
    git(cwd, "remote", "set-url", "origin", path.join(f.tmp, "missing.git"));
    try {
      fs.writeFileSync(path.join(cwd, "more.txt"), "x\n");
      await expect(exportOrResume(id, "box")).rejects.toThrow(
        /missing\.git|push/
      );
    } finally {
      git(cwd, "remote", "set-url", "origin", f.origin);
    }
    expect(row(id).task_status).toBe("moving");
    expect(launchClaude).not.toHaveBeenCalled();
  });

  it("a failed resume leaves it moving, so nothing signs off a stopped agent", async () => {
    const { id } = await seedTask("feature/stuck");
    await exportTask(id, "box");
    vi.mocked(launchClaude).mockRejectedValueOnce(new Error("no tmux"));
    await expect(resumeTask(id)).rejects.toThrow(/no tmux/);
    expect(row(id).task_status).toBe("moving");
  });
});

describe("arriving", () => {
  it("reuses the worktree still on the branch", async () => {
    const { id, cwd } = await seedTask("feature/back");
    const bundle = await exportTask(id, "box");
    markMoved(id, "box");
    const arrived = await importTask(bundle);
    // git names the worktree by its real path (/tmp is /private/tmp on macOS).
    expect(arrived).toMatchObject({
      working_directory: fs.realpathSync(cwd),
      task_status: "running",
      claude_session_id: CLAUDE_ID,
      moved_from: id,
    });
    expect(vi.mocked(launchClaude).mock.calls[0][0]).toMatchObject({
      cwd: fs.realpathSync(cwd),
      resume: CLAUDE_ID,
    });
  });

  it("brings a reused worktree to a branch rewritten elsewhere, keeping the old tip", async () => {
    const { id, cwd } = await seedTask("feature/rewritten");
    const bundle = await exportTask(id, "box");
    markMoved(id, "box");
    const oldTip = git(cwd, "rev-parse", "HEAD");
    // Elsewhere, the agent reworded the pushed wip commit.
    const other = path.join(f.tmp, "rewriter");
    git(f.tmp, "clone", "-q", "-b", "feature/rewritten", f.origin, other);
    git(other, "commit", "-q", "--amend", "-m", "feat: reworded");
    git(other, "push", "-q", "-f", "origin", "feature/rewritten");
    await importTask(bundle);
    expect(git(cwd, "log", "-1", "--format=%s")).toBe("feat: reworded");
    expect(git(f.repo, "rev-parse", `refs/agentos/before-move/${oldTip}`)).toBe(
      oldTip
    );
  });

  it("won't reset away a commit made in the left-behind worktree", async () => {
    const { id, cwd } = await seedTask("feature/left-behind");
    const bundle = await exportTask(id, "box");
    markMoved(id, "box");
    fs.writeFileSync(path.join(cwd, "late.txt"), "late\n");
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", "made after it left");
    await expect(importTask(bundle)).rejects.toThrow(/never left this machine/);
    expect(git(cwd, "log", "-1", "--format=%s")).toBe("made after it left");
  });

  it("makes a fresh worktree and rewrites the conversation to it", async () => {
    const { id, cwd } = await seedTask("feature/fresh");
    const bundle = await exportTask(id, "box");
    markMoved(id, "box");
    git(f.repo, "worktree", "remove", "--force", cwd);
    git(f.repo, "branch", "-D", "feature/fresh");
    const arrived = await importTask(bundle);
    const newCwd = arrived.working_directory;
    expect(newCwd).not.toBe(cwd);
    expect(git(newCwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "feature/fresh"
    );
    expect(fs.readFileSync(path.join(newCwd, "work.txt"), "utf8")).toBe(
      "half done\n"
    );
    const moved = fs.readFileSync(
      path.join(claudeProjectDir(newCwd), `${CLAUDE_ID}.jsonl`),
      "utf8"
    );
    expect(JSON.parse(moved)).toEqual({
      cwd: newCwd,
      text: `read ${newCwd}/work.txt`,
    });
    const launch = vi.mocked(launchClaude).mock.calls[0][0];
    expect(launch.resume).toBe(CLAUDE_ID);
    expect(launch.prompt).toContain("moved here");
    // Its setup runs with the slot it took here, the ones its agent is told.
    const ports = sessionPorts(arrived.id);
    expect(ports).toMatchObject({ PORT: expect.any(Number) });
    await vi.waitFor(() =>
      expect(vi.mocked(setupWorktree)).toHaveBeenCalledWith({
        worktreePath: newCwd,
        sourcePath: expect.any(String),
        ports,
      })
    );
  });

  it("the same move imported twice gives back the first task", async () => {
    const { id } = await seedTask("feature/twice-in");
    const bundle = await exportTask(id, "box");
    markMoved(id, "box");
    const first = await importTask(bundle);
    const second = await importTask(bundle);
    expect(second.id).toBe(first.id);
    expect(launchClaude).toHaveBeenCalledTimes(1);
  });

  it("leaves no row when the agent can't start, so the move can be tried again", async () => {
    const { id } = await seedTask("feature/nolaunch");
    const bundle = await exportTask(id, "box");
    markMoved(id, "box");
    vi.mocked(launchClaude).mockRejectedValueOnce(new Error("no tmux"));
    await expect(importTask(bundle)).rejects.toThrow(/no tmux/);
    const left = db
      .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE moved_from = ?`)
      .get(id) as { n: number };
    expect(left.n).toBe(0);
    await expect(importTask(bundle)).resolves.toMatchObject({
      task_status: "running",
    });
  });

  it("refuses a branch that still has a task here (the one leaving counts)", async () => {
    const { id } = await seedTask("feature/busy");
    const bundle = await exportTask(id, "box");
    await expect(importTask(bundle)).rejects.toThrow(
      /already has a task running/
    );
  });

  it("doesn't count this machine's mirror of the task it's importing", async () => {
    const { id } = await seedTask("feature/mirrored");
    const bundle = await exportTask(id, "box");
    markMoved(id, "box");
    const hostId = createHost("mirror-host", "alice@mirror").id;
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, task_status, branch_name, host_id)
       VALUES (?, 'm', 'claude-m', '/home/x', ?, 'running', 'feature/mirrored', ?)`
    ).run(randomUUID(), f.projectId, hostId);
    await expect(importTask(bundle)).resolves.toMatchObject({
      task_status: "running",
    });
  });

  it("refuses a bundle with a bad branch, session id or move id", async () => {
    const { id } = await seedTask("feature/bad");
    const bundle = await exportTask(id, "box");
    await expect(importTask({ ...bundle, branch: "-x" })).rejects.toThrow(
      /branch/
    );
    await expect(
      importTask({
        ...bundle,
        claude: { ...bundle.claude!, sessionId: "../x" },
      })
    ).rejects.toThrow(/session id/);
    await expect(importTask({ ...bundle, moveId: "x" })).rejects.toThrow(
      /move id/
    );
  });
});
