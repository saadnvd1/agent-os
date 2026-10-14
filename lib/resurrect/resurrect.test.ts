import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPR } from "@/lib/tasks/state";
import { git, makeRepo, WORKTREE_MARK } from "@/lib/done/testing";

// Real repositories; gh, tmux, chat workers and LumifyHub are faked.
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "aos-resurrect-claude-")
);

const prs = new Map<string, TaskPR>();
const ghCalls: string[][] = [];
const cards: [string, string][] = [];

vi.mock("@/lib/tasks/gh", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tasks/gh")>();
  const byNumber = (n: number) =>
    [...prs.entries()].find(([, p]) => p.number === n);
  return {
    ...real,
    run: async (cmd: string, args: string[], cwd: string, t?: number) => {
      if (cmd === "gh") {
        ghCalls.push(args);
        const hit = byNumber(Number(args[2]));
        if (args[1] === "view")
          return JSON.stringify({
            number: Number(args[2]),
            state: hit?.[1].state ?? "OPEN",
          });
        if (hit && args[1] === "close")
          prs.set(hit[0], { ...hit[1], state: "CLOSED" });
        if (hit && args[1] === "reopen")
          prs.set(hit[0], { ...hit[1], state: "OPEN" });
        return "";
      }
      if (cmd === "tmux") throw new Error("no tmux in tests");
      return real.run(cmd, args, cwd, t);
    },
    findPR: async (_repo: string, branch: string) => prs.get(branch) ?? null,
    findPRStrict: async (_repo: string, branch: string) =>
      prs.get(branch) ?? null,
  };
});
vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: () => Promise.resolve(),
    listSessions: async () => [],
    cleanup: () => {},
    hostErrors: () => ({}),
    sessionExists: () => false,
    getStatus: async () => "dead",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => "❯ ",
  },
}));
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async () => ({ stdout: "", stderr: "" }),
}));
vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  stopChat: () => {},
  chatState: () => null,
}));
vi.mock("@/lib/lumifyhub/task-cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lumifyhub/task-cards")>()),
  syncTaskCardInBackground: (s: { id: string }, state: string) =>
    cards.push([s.id, state]),
}));
vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  isAgentOSWorktree: (p: string) => p.includes(WORKTREE_MARK),
}));
vi.mock("@/lib/project-config/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-config/database")>()),
  dropSessionDatabase: async () => {},
}));
vi.mock("@/lib/ports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ports")>()),
  allocatePorts: async () => ({ slot: 1, ports: {} }),
}));
vi.mock("@/lib/env-setup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env-setup")>()),
  setupWorktree: async () => ({}),
}));
vi.spyOn(os, "homedir").mockReturnValue(
  fs.mkdtempSync(path.join(os.tmpdir(), "aos-resurrect-home-"))
);

const { db } = await import("@/lib/db");
const { createProject } = await import("@/lib/projects");
const { createWorkspace, setProjectWorkspace } =
  await import("@/lib/workspaces");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { dropTask } = await import("@/lib/tasks/finish");
const { doneSession } = await import("@/lib/done");
const { archiveSession } = await import("@/lib/done/archive");
const { preparePlanDir, PLAN_FILE } = await import("@/lib/models/plan-step");
const { transcriptPath } = await import("@/lib/tasks/transcript");
const { resurrectSession } = await import("./index");
const { snapshotRef } = await import("./snapshot");
const { endedSessions, resolveEnded } = await import("./find");

beforeEach(() => {
  prs.clear();
  ghCalls.length = 0;
  cards.length = 0;
  delete process.env.AGENTOS_NO_END_SNAPSHOT;
});

interface Row {
  id: string;
  task_status: string | null;
  plan_phase: string | null;
  claude_session_id: string | null;
  archived_at: string | null;
  settled_at: string | null;
  worktree_path: string | null;
  working_directory: string;
  pr_status: string | null;
}
const row = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Row;

function setup() {
  const r = makeRepo();
  const workspace = createWorkspace(`ws-${randomUUID().slice(0, 8)}`);
  const project = createProject({
    name: `app-${randomUUID().slice(0, 8)}`,
    workingDirectory: r.repo,
  });
  setProjectWorkspace(project.id, workspace.id);

  // A chat task on a worktree, with a conversation on disk under it.
  function task(
    name: string,
    opts: { commits?: Record<string, string>; planOnly?: boolean } = {}
  ) {
    const branch = `feature/${name}`;
    const wt = r.worktree(branch, opts.commits);
    const id = seedSession({
      projectId: project.id,
      name,
      task: true,
      branch,
      view: "chat",
    });
    const claudeId = randomUUID();
    db.prepare(
      `UPDATE sessions SET worktree_path = ?, working_directory = ?, base_branch = 'main',
         claude_session_id = ?, plan_only = ?, plan_phase = ? WHERE id = ?`
    ).run(
      wt.dir,
      wt.dir,
      claudeId,
      opts.planOnly ? 1 : 0,
      opts.planOnly ? "awaiting" : null,
      id
    );
    const transcript = (text = `{"type":"user"}\n`) => {
      const file = transcriptPath(wt.dir, claudeId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return file;
    };
    transcript();
    return { id, branch, dir: wt.dir, head: wt.head, claudeId, transcript };
  }

  return { repo: r.repo, project, workspace, task, root: r };
}

const hasRef = (repo: string, ref: string) => {
  try {
    git(repo, "rev-parse", "--verify", "--quiet", ref);
    return true;
  } catch {
    return false;
  }
};

describe("drop, then resurrect", () => {
  it("brings a plan-only task back as it was: same id, same conversation, plan waiting", async () => {
    const t = setup();
    const s = t.task("plan", { planOnly: true });
    preparePlanDir(s.dir);
    fs.writeFileSync(path.join(s.dir, PLAN_FILE), "# The plan\n\nDo it.\n");
    fs.writeFileSync(path.join(s.dir, "README.md"), "edited\n");
    fs.writeFileSync(path.join(s.dir, "notes.txt"), "scratch\n");

    await dropTask(s.id);
    expect(row(s.id).task_status).toBe("dropped");
    expect(fs.existsSync(s.dir)).toBe(false);
    expect(hasRef(t.repo, snapshotRef(s.id))).toBe(true);

    const out = await resurrectSession(s.id);
    expect(out).toMatchObject({
      id: s.id,
      restored: "task",
      worktree: "snapshot",
    });
    const back = row(s.id);
    expect(back).toMatchObject({
      id: s.id,
      task_status: "running",
      plan_phase: "awaiting",
      claude_session_id: s.claudeId,
      worktree_path: s.dir,
      working_directory: s.dir,
      archived_at: null,
    });
    expect(git(s.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe(s.branch);
    expect(fs.readFileSync(path.join(s.dir, PLAN_FILE), "utf8")).toBe(
      "# The plan\n\nDo it.\n"
    );
    expect(fs.readFileSync(path.join(s.dir, "README.md"), "utf8")).toBe(
      "edited\n"
    );
    // Uncommitted, not staged, and the plan stays out of git.
    expect(git(s.dir, "diff", "--cached", "--name-only")).toBe("");
    expect(git(s.dir, "diff", "--name-only")).toBe("README.md");
    expect(git(s.dir, "ls-files", "-o", "--exclude-standard")).toBe(
      "notes.txt"
    );
    expect(hasRef(t.repo, snapshotRef(s.id))).toBe(false);
    // The conversation file is where Claude looks for it.
    expect(fs.existsSync(transcriptPath(s.dir, s.claudeId))).toBe(true);
    expect(cards.at(-1)).toEqual([s.id, "working"]);
  });

  it("reopens the PR a drop closed, and restores its commits", async () => {
    const t = setup();
    const s = t.task("shipping", {
      commits: { "src/a.ts": "export const a = 1;\n" },
    });
    prs.set(s.branch, {
      number: 41,
      url: "https://github.com/o/r/pull/41",
      state: "OPEN",
      checks: "pass",
      head: s.head,
      failing: null,
      checkCount: 1,
      attribution: null,
    });
    db.prepare(
      `UPDATE sessions SET pr_number = 41, pr_status = 'open' WHERE id = ?`
    ).run(s.id);

    await dropTask(s.id);
    expect(prs.get(s.branch)!.state).toBe("CLOSED");
    expect(ghCalls).toContainEqual(["pr", "close", "41"]);

    const out = await resurrectSession(s.id);
    expect(out.prReopened).toBe(41);
    expect(ghCalls).toContainEqual(["pr", "reopen", "41"]);
    expect(prs.get(s.branch)!.state).toBe("OPEN");
    expect(row(s.id)).toMatchObject({
      task_status: "running",
      pr_status: "open",
    });
    // The branch is back on origin with its commit, and in the worktree.
    expect(git(t.repo, "ls-remote", "--heads", "origin", s.branch)).toContain(
      s.head
    );
    expect(git(s.dir, "rev-parse", "HEAD")).toBe(s.head);
  });

  it("restores a task that was marked done and had its worktree removed", async () => {
    const t = setup();
    const s = t.task("finished", { planOnly: true });
    preparePlanDir(s.dir);
    fs.writeFileSync(path.join(s.dir, PLAN_FILE), "plan text\n");
    db.prepare(`UPDATE sessions SET plan_phase = NULL WHERE id = ?`).run(s.id);

    const done = await doneSession(s.id, { by: "direct" });
    expect(done.worktree.action).toBe("removed");
    expect(row(s.id).task_status).toBe("done");

    await resurrectSession(s.id);
    expect(row(s.id)).toMatchObject({
      task_status: "running",
      settled_at: null,
      worktree_path: s.dir,
    });
    expect(fs.readFileSync(path.join(s.dir, PLAN_FILE), "utf8")).toBe(
      "plan text\n"
    );
  });

  it("without a snapshot, a plan-only task gets a fresh branch and its plan back from the conversation", async () => {
    const t = setup();
    const s = t.task("legacy", { planOnly: true });
    const line = (input: object) =>
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Write", input }] },
      });
    s.transcript(
      [
        line({
          file_path: path.join(s.dir, PLAN_FILE),
          content: "# Plan\n\nstep one\n",
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Edit",
                input: {
                  file_path: path.join(s.dir, PLAN_FILE),
                  old_string: "step one",
                  new_string: "step two",
                },
              },
            ],
          },
        }),
      ].join("\n") + "\n"
    );
    process.env.AGENTOS_NO_END_SNAPSHOT = "1";
    await dropTask(s.id);
    expect(hasRef(t.repo, snapshotRef(s.id))).toBe(false);

    const out = await resurrectSession(s.id);
    expect(out.worktree).toBe("fresh");
    expect(row(s.id)).toMatchObject({
      task_status: "running",
      plan_phase: "awaiting",
    });
    expect(fs.readFileSync(path.join(s.dir, PLAN_FILE), "utf8")).toBe(
      "# Plan\n\nstep two\n"
    );
    expect(git(s.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe(s.branch);
  });

  it("without a snapshot or a branch, a task with work comes back as its conversation only", async () => {
    const t = setup();
    const s = t.task("gone", {
      commits: { "src/b.ts": "export const b = 1;\n" },
    });
    process.env.AGENTOS_NO_END_SNAPSHOT = "1";
    await dropTask(s.id);

    const out = await resurrectSession(s.id);
    expect(out.worktree).toBe("chat-only");
    expect(out.text).toMatch(/only the conversation came back/);
    expect(row(s.id)).toMatchObject({
      task_status: null,
      worktree_path: null,
      working_directory: t.repo,
      claude_session_id: s.claudeId,
    });
    expect(fs.existsSync(transcriptPath(t.repo, s.claudeId))).toBe(true);
  });
});

describe("archived and finished sessions", () => {
  it("unarchives an archived plain session and changes nothing else", async () => {
    const t = setup();
    const id = seedSession({
      projectId: t.project.id,
      name: "plain",
      view: "chat",
    });
    archiveSession(id);
    const out = await resurrectSession(id);
    expect(out.restored).toBe("unarchived");
    expect(row(id)).toMatchObject({ archived_at: null, task_status: null });
  });

  it("revives an archived dropped task, which unarchiving alone would leave hidden", async () => {
    const t = setup();
    const s = t.task("shelved", { planOnly: true });
    await dropTask(s.id);
    archiveSession(s.id);
    await resurrectSession(s.id);
    expect(row(s.id)).toMatchObject({
      task_status: "running",
      archived_at: null,
    });
  });

  it("lists what ended, newest first, and finds it by name", async () => {
    const t = setup();
    const s = t.task("listed", { planOnly: true });
    await dropTask(s.id);
    const scope = { workspaceId: t.workspace.id };
    expect(endedSessions(scope).map((e) => e.id)).toContain(s.id);
    expect(endedSessions(scope, { kind: "dropped" })[0]).toMatchObject({
      id: s.id,
      kind: "dropped",
      planWaiting: true,
    });
    expect(resolveEnded("listed", scope)).toBe(s.id);
    expect(() => resolveEnded("listed", { workspaceId: "other" })).toThrow(
      /No dropped, done or archived session/
    );
  });
});

describe("refusals leave the session as it was", () => {
  async function dropped(name: string) {
    const t = setup();
    const s = t.task(name, { planOnly: true });
    await dropTask(s.id);
    return { t, s };
  }

  it("a conversation that's gone from disk", async () => {
    const { s } = await dropped("no-transcript");
    fs.rmSync(transcriptPath(s.dir, s.claudeId));
    await expect(resurrectSession(s.id)).rejects.toThrow(
      /conversation is gone/
    );
    expect(row(s.id).task_status).toBe("dropped");
  });

  it("a merged task", async () => {
    const { s } = await dropped("was-merged");
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      s.id
    );
    await expect(resurrectSession(s.id)).rejects.toThrow(/was merged/);
  });

  it("a PR that GitHub says is merged", async () => {
    const { s } = await dropped("pr-merged");
    prs.set("x", {
      number: 77,
      url: "u",
      state: "MERGED",
      checks: "pass",
      head: "h",
      failing: null,
      checkCount: 1,
      attribution: null,
    });
    db.prepare(`UPDATE sessions SET pr_number = 77 WHERE id = ?`).run(s.id);
    await expect(resurrectSession(s.id)).rejects.toThrow(/PR #77 was merged/);
    expect(row(s.id).task_status).toBe("dropped");
  });

  it("a removed project", async () => {
    const { s } = await dropped("no-project");
    db.prepare(`UPDATE sessions SET project_id = NULL WHERE id = ?`).run(s.id);
    await expect(resurrectSession(s.id)).rejects.toThrow(/project was removed/);
  });

  it("a task that is still running, and a session that never ended", async () => {
    const t = setup();
    const s = t.task("live");
    await expect(resurrectSession(s.id)).rejects.toThrow(/still running/);
    const plain = seedSession({ projectId: t.project.id, name: "alive" });
    await expect(resurrectSession(plain)).rejects.toThrow(
      /isn't dropped, done or archived/
    );
  });

  it("a branch another running task has taken", async () => {
    const { t, s } = await dropped("taken");
    const other = seedSession({
      projectId: t.project.id,
      name: "other",
      task: true,
      branch: s.branch,
    });
    await expect(resurrectSession(s.id)).rejects.toThrow(/other is running on/);
    expect(row(other).task_status).toBe("running");
    expect(row(s.id).task_status).toBe("dropped");
  });

  it("a task on a machine that can't be reached, with nothing kept here", async () => {
    const { s } = await dropped("far-away");
    db.prepare(`UPDATE sessions SET host_id = 'ghost-host' WHERE id = ?`).run(
      s.id
    );
    await expect(resurrectSession(s.id)).rejects.toThrow(
      /nothing of it was kept here/
    );
  });

  it("a second restore while one is running", async () => {
    const { s } = await dropped("twice");
    const results = await Promise.allSettled([
      resurrectSession(s.id),
      resurrectSession(s.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find(
      (r) => r.status === "rejected"
    ) as PromiseRejectedResult;
    expect(String(lost.reason)).toMatch(/being restored already|still running/);
    expect(row(s.id).task_status).toBe("running");
  });

  it("puts the status back when the restore fails part-way", async () => {
    const { t, s } = await dropped("breaks");
    // A worktree path that can't be made.
    fs.rmSync(t.root.repo, { recursive: true, force: true });
    await expect(resurrectSession(s.id)).rejects.toThrow();
    expect(row(s.id).task_status).toBe("dropped");
  });
});

it("keeps drop's own work untouched: no worktree means no snapshot and no failure", async () => {
  const t = setup();
  const s = t.task("bare", { planOnly: true });
  db.prepare(`UPDATE sessions SET worktree_path = NULL WHERE id = ?`).run(s.id);
  await dropTask(s.id);
  expect(row(s.id).task_status).toBe("dropped");
});
