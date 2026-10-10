import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import { seedSession, seedWorkspace } from "./testing";

const hostCalls: string[] = [];
const started: string[] = [];
// How each start asked to run.
const views: { kind: string; view: string }[] = [];
// Chat sessions waiting on an approval, and how a chat send went.
const waitingChats = new Set<string>();
// What typing into a pane comes to; the pane checks have their own tests.
let paneResult: import("@/lib/bus").Delivery = { state: "delivered" };

vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => true,
    getStatus: async () => "idle",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => "",
  },
}));
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async (_host: string, cmd: string) => {
    hostCalls.push(cmd);
    return { stdout: "" };
  },
}));
vi.mock("@/lib/bus/delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bus/delivery")>()),
  deliverToPane: async () => paneResult,
}));
vi.mock("@/lib/tasks/gh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/gh")>()),
  run: async () => "",
  findPR: async () => null,
}));
// Starts make a session row and nothing else: no worktree, no tmux.
vi.mock("@/lib/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks")>()),
  createTask: async (o: {
    projectId: string;
    prompt: string;
    view?: string;
  }) => {
    started.push(o.prompt);
    views.push({ kind: "task", view: o.view ?? "terminal" });
    const id = seedSession({
      projectId: o.projectId,
      name: o.prompt,
      task: true,
    });
    return {
      id,
      name: o.prompt,
      branch_name: "feature/x",
      base_branch: "main",
    } as Session;
  },
}));
vi.mock("@/lib/agents/spawn", () => ({
  spawnSession: async (o: { project: string; prompt: string }) => {
    started.push(o.prompt);
    views.push({ kind: "session", view: "terminal" });
    const id = seedSession({ projectId: o.project, name: o.prompt });
    return { id, name: o.prompt, view: "terminal" } as Session;
  },
}));
vi.mock("@/lib/sessions/launch", () => ({
  DEFAULT_START_VIEW: "chat",
  launchSession: async (o: {
    projectId: string;
    prompt: string;
    view?: string;
    access?: string;
  }) => {
    started.push(o.prompt);
    views.push({ kind: "session", view: `${o.view}/${o.access}` });
    const id = seedSession({
      projectId: o.projectId,
      name: o.prompt,
      view: "chat",
    });
    return { session: { id, name: o.prompt, view: "chat" } as Session };
  },
}));
vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  chatState: (id: string) => (waitingChats.has(id) ? "waiting" : null),
  sendChatConfirmed: async (id: string) =>
    waitingChats.has(id) ? "queued" : "delivered",
}));
vi.mock("./usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./usage")>()),
  readUsage: () => ({ window: null }),
}));

const { db } = await import("@/lib/db");
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { recentlyMessaged } = await import("./conditions");
const { listNotes } = await import("./notes");
const { listItems } = await import("@/lib/chat/store");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-act-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

// Two workspaces: every tool, pointed at the other one's things, refuses.
function twoWorkspaces() {
  const mine = seedWorkspace();
  const other = seedWorkspace();
  ensureOrchestrator(mine.workspace.id);
  ensureOrchestrator(other.workspace.id);
  const stackId = randomUUID();
  db.prepare(
    `INSERT INTO stacks (id, project_id, lh_board_id, name, status, max_parallel)
     VALUES (?, ?, 'b', 'Other stack', 'running', 2)`
  ).run(stackId, other.api.id);
  return { mine, other, stackId };
}

describe("workspace scoping", () => {
  it("refuses every tool's target outside the workspace", async () => {
    const { mine, other, stackId } = twoWorkspaces();
    const theirs = other.task;
    const w = mine.workspace.id;
    const cases: [Parameters<typeof runTool>[1], object][] = [
      ["read", { session: theirs }],
      ["send", { session: theirs, message: "hi" }],
      ["start_task", { project: other.api.name, prompt: "x" }],
      ["start_session", { project: other.app.name, prompt: "x" }],
      ["stack", { target: "Roadmap-of-another" }],
      ["stack", { target: other.app.name, plan_only: true }],
      ["stack_status", { id: stackId }],
      ["land", { id: stackId }],
      ["drop", { task: theirs, reason: "no" }],
      ["stop", { session: theirs }],
      ["review", { target: theirs }],
      ["sign_off", { task: theirs }],
    ];
    for (const [tool, args] of cases) {
      const error = await runTool(w, tool, args).then(
        () => null,
        (e: Error) => e.message
      );
      expect(error, tool).toMatch(
        /No (session|project|stack) .* (in this workspace|in ws-)/
      );
    }
    expect(started).toEqual([]);
    expect(hostCalls).toEqual([]);
  });

  it("refuses a PR number that's only a task elsewhere", async () => {
    const { mine, other } = twoWorkspaces();
    db.prepare(`UPDATE sessions SET pr_number = 4242 WHERE id = ?`).run(
      other.task
    );
    await expect(
      runTool(mine.workspace.id, "sign_off", { task: "#4242" })
    ).rejects.toThrow(/No session "#4242" in this workspace/);
  });
});

describe("acting inside the workspace", () => {
  it("sends as the orchestrator, so the quiet window knows who spoke", async () => {
    const { mine } = twoWorkspaces();
    const orch = ensureOrchestrator(mine.workspace.id);
    const text = await runTool(mine.workspace.id, "send", {
      session: "add-auth",
      message: "rebase on main please",
    });
    expect(text).toMatch(/^Delivered to add-auth/);
    const row = db
      .prepare(
        `SELECT from_id, to_id FROM bus_messages ORDER BY id DESC LIMIT 1`
      )
      .get() as { from_id: string; to_id: string };
    expect(row).toEqual({ from_id: orch.id, to_id: mine.task });
    expect(recentlyMessaged(orch.id, Date.now()).has(mine.task)).toBe(true);
  });

  it("says when a message didn't land, and leaves it in the inbox", async () => {
    const { mine } = twoWorkspaces();
    ensureOrchestrator(mine.workspace.id);
    paneResult = { state: "failed", why: "it is showing a menu" };
    try {
      const text = await runTool(mine.workspace.id, "send", {
        session: "add-auth",
        message: "are you there?",
      });
      expect(text).toMatch(/^FAILED to reach add-auth: it is showing a menu/);
      const row = db
        .prepare(
          `SELECT delivered_at, read_at FROM bus_messages ORDER BY id DESC LIMIT 1`
        )
        .get();
      expect(row).toEqual({ delivered_at: null, read_at: null });
    } finally {
      paneResult = { state: "delivered" };
    }
  });

  it("starts a task and a session in its own projects, as chats", async () => {
    const { mine } = twoWorkspaces();
    const w = mine.workspace.id;
    views.length = 0;
    expect(
      await runTool(w, "start_task", {
        project: mine.api.name,
        prompt: "add rate limits",
      })
    ).toMatch(/Started task "add rate limits" \(id \w{8}, chat\) in api-/);
    expect(
      await runTool(w, "start_session", {
        project: mine.app.name,
        prompt: "look at logs",
      })
    ).toMatch(/Started session "look at logs" \(id \w{8}, chat\)/);
    expect(views).toEqual([
      { kind: "task", view: "chat" },
      { kind: "session", view: "chat/full" },
    ]);
  });

  it("queues a task with after, and tells the orchestrator when it starts", async () => {
    const { mine } = twoWorkspaces();
    const w = mine.workspace.id;
    started.length = 0;
    const text = await runTool(w, "start_task", {
      project: mine.app.name,
      prompt: "follow up on auth",
      name: "auth follow-up",
      after: "add-auth",
    });
    expect(text).toMatch(
      /^Queued \(position 1\) task "auth follow-up" \(id \w{8}\) in app-\w+, after add-auth\./
    );
    expect(started).not.toContain("follow up on auth");
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      mine.task
    );
    const { tickQueue } = await import("@/lib/tasks/queue");
    await tickQueue();
    expect(started).toContain("follow up on auth");
    const events = db
      .prepare(
        `SELECT line FROM orchestrator_events WHERE workspace_id = ? AND key LIKE 'once:queued-start:%'`
      )
      .all(w) as { line: string }[];
    expect(events.map((e) => e.line)).toEqual([
      expect.stringMatching(
        /^Queued task "follow up on auth" \(id \w{8}\) started/
      ),
    ]);
    await expect(
      runTool(w, "start_task", {
        project: mine.app.name,
        prompt: "x",
        after: "nothing-like-this",
      })
    ).rejects.toThrow(/No running or queued task matches/);
  });

  it("never waits on another workspace's task, by id or prefix", async () => {
    const { mine, other } = twoWorkspaces();
    for (const after of [other.task, other.task.slice(0, 8)])
      await expect(
        runTool(mine.workspace.id, "start_task", {
          project: mine.app.name,
          prompt: "x",
          after,
        })
      ).rejects.toThrow(/No running or queued task matches/);
  });

  it("a queued task the brakes refuse waits in line; start now is braked too", async () => {
    const { mine } = twoWorkspaces();
    const w = mine.workspace.id;
    started.length = 0;
    await runTool(w, "start_task", {
      project: mine.app.name,
      prompt: "braked follow-up",
      after: mine.task,
    });
    const { tickQueue, listQueue, startQueuedNow } =
      await import("@/lib/tasks/queue");
    const id = listQueue().find((q) => q.prompt === "braked follow-up")!.id;
    process.env.AGENTOS_ORCH_BRAKES = "1";
    db.prepare(
      `UPDATE workspaces SET orch_max_starts_per_hour = 0 WHERE id = ?`
    ).run(w);
    try {
      db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
        mine.task
      );
      await tickQueue();
      expect(started).not.toContain("braked follow-up");
      const row = db
        .prepare(`SELECT status, note, attempts FROM task_queue WHERE id = ?`)
        .get(id) as { status: string; note: string; attempts: number };
      expect(row).toMatchObject({ status: "queued", attempts: 0 });
      expect(row.note).toMatch(/^Waiting: .*starts in the last hour/);
      await expect(startQueuedNow(id)).rejects.toThrow(/^Brake: /);
      expect(started).not.toContain("braked follow-up");
    } finally {
      delete process.env.AGENTOS_ORCH_BRAKES;
      db.prepare(
        `UPDATE workspaces SET orch_max_starts_per_hour = 6 WHERE id = ?`
      ).run(w);
    }
  });

  it("a queued task whose project left the workspace isn't started", async () => {
    const { mine, other } = twoWorkspaces();
    const w = mine.workspace.id;
    started.length = 0;
    await runTool(w, "start_task", {
      project: mine.app.name,
      prompt: "moved away",
      after: mine.task,
    });
    const { listQueue, tickQueue } = await import("@/lib/tasks/queue");
    const id = listQueue().find((q) => q.prompt === "moved away")!.id;
    db.prepare(`UPDATE projects SET workspace_id = ? WHERE id = ?`).run(
      other.workspace.id,
      mine.app.id
    );
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      mine.task
    );
    await tickQueue();
    expect(started).not.toContain("moved away");
    expect(
      db.prepare(`SELECT status, error FROM task_queue WHERE id = ?`).get(id)
    ).toEqual({
      status: "failed",
      error:
        "Not started: its project left the orchestrator's workspace or this machine",
    });
  });

  it("a start cut off by a restart after its task exists is announced and counted", async () => {
    const { mine } = twoWorkspaces();
    const w = mine.workspace.id;
    await runTool(w, "start_task", {
      project: mine.app.name,
      prompt: "cut off",
      after: mine.task,
    });
    const { listQueue, recoverQueue } = await import("@/lib/tasks/queue");
    const id = listQueue().find((q) => q.prompt === "cut off")!.id;
    db.prepare(`UPDATE task_queue SET status = 'starting' WHERE id = ?`).run(
      id
    );
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, task_status)
       VALUES (?, 'cut off', 'claude-cut', '/tmp', ?, 'running')`
    ).run(id, mine.app.id);
    recoverQueue();
    const event = db
      .prepare(
        `SELECT line FROM orchestrator_events WHERE workspace_id = ? AND key = ?`
      )
      .get(w, `once:queued-start:${id}`) as { line: string } | undefined;
    expect(event?.line).toMatch(/^Queued task "cut off"/);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM orchestrator_starts WHERE target = ?`
        )
        .get(id)
    ).toEqual({ n: 1 });
  });

  it("starts in a terminal when asked to, for a job that needs a TUI", async () => {
    const { mine } = twoWorkspaces();
    const w = mine.workspace.id;
    views.length = 0;
    expect(
      await runTool(w, "start_task", {
        project: mine.api.name,
        prompt: "profile the tui",
        view: "terminal",
      })
    ).toMatch(/\(id \w{8}, terminal\)/);
    expect(
      await runTool(w, "start_session", {
        project: mine.app.name,
        prompt: "drive htop",
        view: "terminal",
      })
    ).toMatch(/\(id \w{8}, terminal\)/);
    expect(views).toEqual([
      { kind: "task", view: "terminal" },
      { kind: "session", view: "terminal" },
    ]);
    await expect(
      runTool(w, "start_task", {
        project: mine.api.name,
        prompt: "x",
        view: "tmux",
      })
    ).rejects.toThrow(/Bad arguments for start_task: view/);
  });

  it("refuses a chat session on another machine's project", async () => {
    const { mine } = twoWorkspaces();
    const host = randomUUID();
    db.prepare(
      `INSERT INTO hosts (id, name, ssh_target) VALUES (?, 'other', 'u@other')`
    ).run(host);
    db.prepare(`UPDATE projects SET host_id = ? WHERE id = ?`).run(
      host,
      mine.app.id
    );
    views.length = 0;
    await expect(
      runTool(mine.workspace.id, "start_session", {
        project: mine.app.name,
        prompt: "x",
      })
    ).rejects.toThrow(/other machines isn't supported/);
    expect(views).toEqual([]);
  });

  it("says when a chat it messaged is waiting on an approval, as a terminal's menu does", async () => {
    const { mine } = twoWorkspaces();
    ensureOrchestrator(mine.workspace.id);
    // The terminal at a prompt refuses; the chat queues it behind the card.
    paneResult = {
      state: "failed",
      why: "it is showing a menu or prompt waiting for an answer",
    };
    waitingChats.add(mine.chat);
    try {
      const terminal = await runTool(mine.workspace.id, "send", {
        session: "add-auth",
        message: "status?",
      });
      expect(terminal).toMatch(
        /^FAILED to reach add-auth: it is showing a menu/
      );
      const chat = await runTool(mine.workspace.id, "send", {
        session: "chat-one",
        message: "status?",
      });
      expect(chat).toMatch(
        /^Queued for chat-one, but it's waiting on an approval or question in its chat/
      );
      waitingChats.delete(mine.chat);
      expect(
        await runTool(mine.workspace.id, "send", {
          session: "chat-one",
          message: "status?",
        })
      ).toMatch(/^Delivered to chat-one/);
    } finally {
      paneResult = { state: "delivered" };
      waitingChats.clear();
    }
  });

  it("stops a terminal session by its own tmux name", async () => {
    const { mine } = twoWorkspaces();
    hostCalls.length = 0;
    await runTool(mine.workspace.id, "stop", { session: "add-auth" });
    expect(hostCalls).toEqual([
      expect.stringContaining(`kill-session -t '=claude-${mine.task}'`),
    ]);
  });

  it("notes into the decision log and the orchestrator's chat", async () => {
    const { mine } = twoWorkspaces();
    const orch = ensureOrchestrator(mine.workspace.id);
    await runTool(mine.workspace.id, "note", {
      text: "Holding api work until CI is fixed",
    });
    expect(listNotes(mine.workspace.id).map((n) => n.text)).toEqual([
      "Holding api work until CI is fixed",
    ]);
    expect(listItems(orch.id).at(-1)).toMatchObject({
      kind: "note",
      tone: "note",
      text: "Holding api work until CI is fixed",
    });
  });
});

describe("the tool route and its arguments", () => {
  it("answers only the workspace's orchestrator worker", async () => {
    const { POST } =
      await import("@/app/api/workspaces/[id]/orchestrator/tools/route");
    const { orchestratorToken } = await import("./home");
    const { NextRequest } = await import("next/server");
    const { mine, other } = twoWorkspaces();
    const call = (id: string, token?: string) =>
      POST(
        new NextRequest(
          `http://127.0.0.1/api/workspaces/${id}/orchestrator/tools`,
          {
            method: "POST",
            headers: token ? { "x-agentos-orchestrator": token } : {},
            body: JSON.stringify({ tool: "note", args: { text: "hi" } }),
          }
        ),
        { params: Promise.resolve({ id }) }
      );
    const w = mine.workspace.id;
    expect((await call(w)).status).toBe(403);
    expect((await call(w, "nope")).status).toBe(403);
    // Another workspace's secret isn't this one's.
    expect((await call(w, orchestratorToken(other.workspace.id))).status).toBe(
      403
    );
    const ok = await call(w, orchestratorToken(w));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("Noted.");
  });

  it("validates arguments, and a base must be a branch name", async () => {
    const { mine } = twoWorkspaces();
    const w = mine.workspace.id;
    await expect(runTool(w, "send", { session: "add-auth" })).rejects.toThrow(
      /Bad arguments for send: message/
    );
    await expect(
      runTool(w, "note", { text: "x", extra: true })
    ).rejects.toThrow(/Bad arguments for note/);
    for (const base of ["-x", "--upload-pack=evil", "a..b", 'x";rm -rf ~;"'])
      await expect(
        runTool(w, "start_task", { project: mine.api.name, prompt: "p", base })
      ).rejects.toThrow(/base not a branch name/);
    const { isBranchName } = await import("@/lib/git");
    expect(["main", "release/1.2", "feature/x_y-z"].every(isBranchName)).toBe(
      true
    );
  });
});

describe("the check process", () => {
  it("gets only an allowlisted environment", async () => {
    const { checkEnv } = await import("./claude-cli");
    expect(
      checkEnv({
        PATH: "/bin",
        HOME: "/h",
        GITHUB_TOKEN: "secret",
        AGENTOS_URL: "http://x",
        AWS_SECRET_ACCESS_KEY: "k",
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ PATH: "/bin", HOME: "/h" });
  });
});
