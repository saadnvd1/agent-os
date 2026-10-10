import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Worktrees and the scratch folder live under a home of the test's own.
const home = vi.hoisted(() =>
  // A folder of this run's own, next to its test database.
  process.env.DB_PATH!.replace(/[^/]+$/, "home")
);
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const homedir = () => home;
  return { ...actual, homedir, default: { ...actual, homedir } };
});
// No agent is started: the first message's delivery is what's checked.
const sent = vi.hoisted(() => [] as { sessionId: string; id: string }[]);
vi.mock("../chat/runner", () => ({
  sendQueuedNow: async (sessionId: string, id: string) => {
    sent.push({ sessionId, id });
  },
}));

import { db, type Session } from "../db";
import { createProject } from "../projects";
import { listQueue } from "../chat/queued";
import { saveItem } from "../chat/store";
import type { ChatItem } from "../chat/events";
import { launchSession, SCRATCH_DIR } from "./launch";
import {
  finishSetup,
  holdsQueue,
  settingUp,
  startSetup,
} from "./setup-progress";
import { failInterruptedSetups } from "./worktree-setup";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "aos-launch-repo-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "first");
  return dir;
}

const row = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session;

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(() => {
  sent.length = 0;
});

describe("launchSession (a draft's first send)", () => {
  it("makes a scratch chat in the scratch folder and sends its first message", async () => {
    const { session } = await launchSession({
      agentType: "claude",
      prompt: "What's the tallest mountain?",
      access: "ask",
    });
    expect(SCRATCH_DIR.startsWith(home)).toBe(true);
    expect(fs.existsSync(SCRATCH_DIR)).toBe(true);
    expect(row(session.id)).toMatchObject({
      working_directory: SCRATCH_DIR,
      project_id: "uncategorized",
      view: "chat",
      chat_access: "ask",
      setup_status: null,
    });
    // Queued first, so a restart can't lose it, then sent at once.
    const [queued] = listQueue(session.id);
    expect(queued.text).toBe("What's the tallest mountain?");
    await until(() => sent.length === 1);
    expect(sent[0]).toEqual({ sessionId: session.id, id: queued.id });
  });

  it("makes one session for a repeated key, even while the first is starting", async () => {
    const id = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";
    const start = () =>
      launchSession({
        id,
        agentType: "claude",
        prompt: "Just once",
        name: "once",
      });
    const [a, b] = await Promise.all([start(), start()]);
    const c = await start();
    expect([a.session.id, b.session.id, c.session.id]).toEqual([id, id, id]);
    expect([a.repeat, b.repeat, c.repeat]).toEqual([undefined, true, true]);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE id = ?`).get(id)
    ).toEqual({ n: 1 });
    await until(() => sent.length === 1);
    expect(listQueue(id)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("refuses a key that isn't a session id, or names a task", async () => {
    await expect(
      launchSession({ id: "../x", agentType: "claude" })
    ).rejects.toThrow(/Bad session id/);
    const task = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, task_prompt, task_status)
       VALUES (?, 't', 'claude-t', '~', 'do it', 'running')`
    ).run(task);
    await expect(
      launchSession({ id: task, agentType: "claude" })
    ).rejects.toThrow(/taken/);
  });

  it("builds the worktree first, renames its branch from the first message, then sends", async () => {
    const repo = makeRepo();
    const project = createProject({ name: "repo", workingDirectory: repo });
    const { session } = await launchSession({
      projectId: project.id,
      agentType: "claude",
      useWorktree: true,
      prompt: "Fix the login redirect loop",
    });
    const temp = `feature/draft-${session.id.slice(0, 8)}`;
    // The agent's folder is known before the worktree exists.
    expect(row(session.id).working_directory).toContain(
      path.join(home, ".agent-os", "worktrees")
    );
    expect(row(session.id).setup_status).toBe("running");
    expect(sent).toHaveLength(0);

    await until(() => !settingUp(session.id) && sent.length === 1);
    const done = row(session.id);
    expect(done.setup_status).toBe("ok");
    expect(fs.existsSync(done.working_directory)).toBe(true);
    expect(done.branch_name).toMatch(/^feature\/fix-the-login-redirect-loop-/);
    expect(git(done.working_directory, "branch", "--show-current")).toBe(
      done.branch_name
    );
    expect(git(repo, "branch", "--list", temp)).toBe("");
  });

  it("keeps the temporary branch when there's nothing to name it from", async () => {
    const repo = makeRepo();
    const project = createProject({ name: "repo2", workingDirectory: repo });
    const { session } = await launchSession({
      projectId: project.id,
      agentType: "claude",
      useWorktree: true,
      images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }],
    });
    await until(() => !settingUp(session.id));
    expect(row(session.id).branch_name).toBe(
      `feature/draft-${session.id.slice(0, 8)}`
    );
  });

  it("leaves the message queued and falls back to the project's folder when the worktree fails", async () => {
    const notRepo = fs.mkdtempSync(path.join(tmpdir(), "aos-launch-plain-"));
    const project = createProject({ name: "plain", workingDirectory: notRepo });
    const { session } = await launchSession({
      projectId: project.id,
      agentType: "claude",
      useWorktree: true,
      prompt: "Do a thing",
    });
    await until(() => !settingUp(session.id));
    const failed = row(session.id);
    expect(failed.setup_status).toBe("failed");
    expect(failed.setup_error).toMatch(/not a git repository/i);
    expect(failed.working_directory).toBe(notRepo);
    expect(listQueue(session.id)).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("hands a terminal agent its first message to start with", async () => {
    const { session, initialPrompt } = await launchSession({
      agentType: "aider",
      prompt: "Hello",
    });
    expect(row(session.id).view).toBe("terminal");
    expect(initialPrompt).toBe("Hello");
    expect(listQueue(session.id)).toHaveLength(0);
  });

  it("refuses a bad branch, an unknown machine and a remote worktree, making nothing", async () => {
    const repo = makeRepo();
    const project = createProject({ name: "repo4", workingDirectory: repo });
    const before = (
      db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }
    ).n;
    await expect(
      launchSession({
        projectId: project.id,
        agentType: "claude",
        useWorktree: true,
        baseBranch: "x; touch /tmp/p",
        prompt: "hi",
      })
    ).rejects.toThrow(/isn't a branch name/);
    await expect(
      launchSession({ agentType: "claude", hostId: "nope", prompt: "hi" })
    ).rejects.toThrow(/Unknown machine/);
    db.prepare(
      `INSERT INTO hosts (id, name, ssh_target) VALUES ('devbox', 'devbox', 'alice@devbox')`
    ).run();
    const remote = createProject({
      name: "remote",
      workingDirectory: "~/dev/remote",
      hostId: "devbox",
    });
    await expect(
      launchSession({
        projectId: remote.id,
        agentType: "claude",
        useWorktree: true,
        prompt: "hi",
      })
    ).rejects.toThrow(/not available on other machines/);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number })
        .n
    ).toBe(before);
  });

  it("holds a queue whose setup failed or was cut off, until it's sent by hand", () => {
    db.prepare(
      `INSERT INTO sessions (id, name, working_directory, setup_status, task_status)
       VALUES ('held', 'held', '/tmp', 'failed', NULL),
              ('busy', 'busy', '/tmp', 'running', NULL),
              ('fine', 'fine', '/tmp', 'ok', NULL),
              ('plain', 'plain', '/tmp', NULL, NULL),
              ('task', 'task', '/tmp', 'failed', 'running')`
    ).run();
    // Set up fine, never had a setup, or a task (lib/tasks/start's): free.
    for (const id of ["fine", "plain", "task"])
      expect(holdsQueue(id)).toBe(false);
    // A setup that failed in this process, before the row says so.
    const view = startSetup("mem", "b");
    expect(holdsQueue("mem")).toBe(true);
    finishSetup("mem", view, "boom");
    expect(holdsQueue("mem")).toBe(true);
    expect(holdsQueue("held")).toBe(true);
    expect(settingUp("held")).toBe(false);
    // After a restart the in-memory setups are gone; the row still says.
    expect(settingUp("busy")).toBe(true);
    expect(holdsQueue("busy")).toBe(true);
    // Once they've sent a message by hand, it's an ordinary conversation.
    saveItem("held", {
      id: "user-1",
      kind: "user",
      text: "go",
      createdAt: Date.now(),
    } as ChatItem);
    expect(holdsQueue("held")).toBe(false);
  });

  it("fails setup when the fetch fails, rather than cut from an old base", async () => {
    const repo = makeRepo();
    git(repo, "remote", "add", "origin", path.join(tmpdir(), "aos-gone.git"));
    const project = createProject({ name: "repo5", workingDirectory: repo });
    const { session } = await launchSession({
      projectId: project.id,
      agentType: "claude",
      useWorktree: true,
      prompt: "Do it",
    });
    await until(() => !settingUp(session.id));
    expect(row(session.id)).toMatchObject({
      setup_status: "failed",
      worktree_path: null,
    });
    expect(row(session.id).setup_error).toMatch(/^Fetching main failed/);
    expect(sent).toHaveLength(0);
  });

  it("marks a setup a restart cut off as failed, in the project's folder", () => {
    const repo = makeRepo();
    const project = createProject({ name: "repo3", workingDirectory: repo });
    db.prepare(
      `INSERT INTO sessions (id, name, working_directory, project_id, setup_status)
       VALUES ('cut', 'cut', '/nowhere', ?, 'running')`
    ).run(project.id);
    expect(failInterruptedSetups()).toBeGreaterThanOrEqual(1);
    expect(row("cut")).toMatchObject({
      setup_status: "failed",
      working_directory: repo,
    });
  });
});
