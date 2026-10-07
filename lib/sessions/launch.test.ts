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
import { launchSession, SCRATCH_DIR } from "./launch";
import { settingUp } from "./setup-progress";
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
