// Everything that watches a task, run on the same scenario for a task in a
// chat and one in a terminal: both have to read the same.

import { describe, expect, it, vi } from "vitest";
import type { ChatState } from "@/lib/chat/events";
import type { Session } from "@/lib/db";
import { seedSession, seedWorkspace } from "./testing";

type View = "chat" | "terminal";

// A terminal's screen, by tmux name: its status and what it shows.
const screens = new Map<string, { status: string; pane: string }>();
// A chat's state, by session id.
const chats = new Map<string, ChatState>();
// Chats whose worker runs but can't be reached.
const unreachable = new Set<string>();
const stopped: string[] = [];
const runs: string[][] = [];

vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: (pane: string) => pane.includes("Do you want"),
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: (tmux: string) => screens.has(tmux),
    getStatus: async (tmux: string) => screens.get(tmux)?.status ?? "dead",
    capturePane: async (tmux: string) => screens.get(tmux)?.pane ?? "",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    foregroundFor: () => null,
    paneProcess: () => null,
  },
}));
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async (_host: string, cmd: string) => {
    const tmux = /=([^:']+):/.exec(cmd)?.[1] ?? "";
    return { stdout: screens.get(tmux)?.pane ?? "" };
  },
}));
vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  chatState: (id: string) => chats.get(id) ?? null,
  chatStateNow: async (id: string) => {
    if (unreachable.has(id)) throw new Error("socket refused");
    return chats.get(id) ?? null;
  },
  stopChat: (id: string) => stopped.push(id),
}));
vi.mock("@/lib/tasks/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/session")>()),
  prFor: async () => null,
}));
vi.mock("@/lib/tasks/gh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/gh")>()),
  run: async (cmd: string, args: string[]) => (runs.push([cmd, ...args]), ""),
}));
vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  deleteWorktree: async () => {},
}));

const { db } = await import("@/lib/db");
const { saveItem } = await import("@/lib/chat/store");
const { waitingState } = await import("./task-state");
const { evaluateGates } = await import("./gates");
const { sessionFacts } = await import("./facts");
const { conditionsFor } = await import("./conditions");
const { readSession } = await import("./read");
const { dropTask, taskView } = await import("@/lib/tasks");
const { moveRefusal } = await import("@/lib/tasks/move-guard");
const { sessionUsage } = await import("@/lib/load/monitor");
const { workerTmuxName } = await import("@/lib/chat/worker/protocol");
const { roleExtras } = await import("@/lib/chat/worker/extras");
const { buildTaskBrief } = await import("@/lib/tasks/brief");

const VIEWS: View[] = ["chat", "terminal"];
const minsAgo = (m: number) => Date.now() - m * 60_000;
const sqlite = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19);

function row(id: string): Session {
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session;
}

let n = 0;
// A running task in its own workspace, its agent having said `said`.
function task(
  view: View,
  agent: {
    said: string;
    // A chat's state, or a terminal's status.
    state: "running" | "idle" | "waiting";
    // A terminal's prompt on screen; a chat's approval card.
    prompt?: boolean;
    at?: number;
  }
) {
  const ws = seedWorkspace();
  const name = `t-${view}-${++n}`;
  const id = seedSession({
    projectId: ws.api.id,
    name,
    view,
    task: true,
    branch: `feature/${name}`,
    updatedAt: agent.at ? sqlite(agent.at) : undefined,
  });
  const at = agent.at ?? Date.now();
  if (view === "chat") {
    saveItem(id, { id: "user-1", kind: "user", text: "Do it", createdAt: at });
    saveItem(id, {
      id: "a1",
      kind: "assistant",
      text: agent.said,
      createdAt: at,
    });
    if (agent.prompt)
      saveItem(id, {
        id: "ap1",
        kind: "approval",
        status: "pending",
        title: "Run rm -rf build",
        createdAt: at,
      } as never);
    else saveItem(id, { id: "e1", kind: "turn_end", createdAt: at });
    chats.set(
      id,
      agent.prompt ? "waiting" : agent.state === "running" ? "running" : "idle"
    );
  } else {
    const prompt = agent.prompt ? "\nDo you want to proceed?\n❯ 1. Yes" : "";
    screens.set(`claude-${id}`, {
      status: agent.state === "running" ? "running" : "waiting",
      pane: `⏺ ${agent.said.split("\n").join("\n⏺ ")}${prompt}`,
    });
  }
  return { ws, id, name };
}

// The other side answered: a message to the chat, a new screen.
function answer(view: View, id: string) {
  if (view === "chat") {
    saveItem(id, {
      id: "user-2",
      kind: "user",
      from: "orchestrator",
      text: "Use the staging key",
      createdAt: Date.now(),
    } as never);
    chats.set(id, "running");
  } else
    screens.set(`claude-${id}`, { status: "running", pane: "⏺ Using staging" });
}

const gate = (w: Awaited<ReturnType<typeof waitingState>>) =>
  evaluateGates({
    sha: "a".repeat(40),
    checks: "pass",
    settleIn: 0,
    review: null,
    ruleBreaks: [],
    fromCard: false,
    scope: null,
    stackRefusal: null,
    codeReviewRefusal: null,
    ...w,
  }).find((g) => g.gate === "blocked")!;

async function lines(workspaceId: string, id: string) {
  const facts = (await sessionFacts(workspaceId)).filter((f) => f.id === id);
  return conditionsFor(facts, []).map((c) => c.line);
}

describe.each(VIEWS)("a %s task", (view) => {
  it("is BLOCKED by its BLOCKED: line, in the gate, its state and an event, until answered", async () => {
    const t = task(view, {
      said: "Looked at the deploy.\nBLOCKED: need the prod key",
      state: "idle",
    });
    const w = await waitingState(row(t.id));
    expect(w.blocked).toContain("need the prod key");
    expect(gate(w)).toMatchObject({ state: "fail" });
    expect(gate(w).reason).toContain("need the prod key");
    const v = await taskView(row(t.id));
    expect(v.state).toBe("blocked");
    expect(v.blocked).toBe("need the prod key");
    expect(await lines(t.ws.workspace.id, t.id)).toContainEqual(
      expect.stringMatching(/BLOCKED: [\s\S]*need the prod key/)
    );

    answer(view, t.id);
    const after = await waitingState(row(t.id));
    expect(after.blocked).toBeNull();
    expect(gate(after)).toMatchObject({ state: "pass" });
    expect((await taskView(row(t.id))).state).toBe("working");
  });

  it("holds the gate and raises needs-input while it waits on an approval or prompt", async () => {
    const t = task(view, {
      said: "About to clean",
      state: "waiting",
      prompt: true,
    });
    const w = await waitingState(row(t.id));
    expect(w.blocked).toBeNull();
    expect(w.waitingOn).toBe(
      view === "chat"
        ? "an approval or question in its chat"
        : "a prompt in its terminal"
    );
    expect(gate(w)).toMatchObject({ state: "fail" });
    expect(gate(w).reason).toMatch(/waiting on an answer/);
    const facts = (await sessionFacts(t.ws.workspace.id)).find(
      (f) => f.id === t.id
    )!;
    expect(facts.needsInput).toBe(true);
    expect(await lines(t.ws.workspace.id, t.id)).toContainEqual(
      expect.stringMatching(/needs input/)
    );
  });

  it("raises idle with no PR after half an hour, and not while it works", async () => {
    const idle = task(view, {
      said: "Done thinking",
      state: "idle",
      at: minsAgo(40),
    });
    expect(await lines(idle.ws.workspace.id, idle.id)).toContainEqual(
      expect.stringMatching(/idle 4\dm, no PR/)
    );
    const busy = task(view, {
      said: "Working",
      state: "running",
      at: minsAgo(40),
    });
    expect(await lines(busy.ws.workspace.id, busy.id)).not.toContainEqual(
      expect.stringMatching(/no PR/)
    );
  });

  it("reads back its last words for the orchestrator, fenced as untrusted", async () => {
    const t = task(view, {
      said: "All tests pass\nOpening the PR",
      state: "idle",
    });
    const out = await readSession(t.ws.workspace.id, t.name, 10);
    expect(out).toContain(`(${view})`);
    expect(out).toContain("Opening the PR");
    expect(out).toMatch(/untrusted/i);
  });

  it("is stopped and cleaned up when dropped", async () => {
    const t = task(view, { said: "Working", state: "running" });
    stopped.length = 0;
    runs.length = 0;
    await dropTask(t.id);
    expect(row(t.id).task_status).toBe("dropped");
    expect(runs).toContainEqual([
      "tmux",
      "kill-session",
      "-t",
      `=claude-${t.id}`,
    ]);
    expect(stopped).toEqual(view === "chat" ? [t.id] : []);
  });
});

describe.each(VIEWS)("a %s task not launched yet", (view) => {
  for (const setup of ["running", "held"])
    it(`reads as setting up while its start is ${setup}, never idle`, async () => {
      const t = task(view, { said: "", state: "idle", at: minsAgo(40) });
      // No agent yet: no worker state, no chat, no screen.
      chats.delete(t.id);
      db.prepare(`DELETE FROM chat_items WHERE session_id = ?`).run(t.id);
      screens.delete(`claude-${t.id}`);
      db.prepare(`UPDATE sessions SET setup_status = ? WHERE id = ?`).run(
        setup,
        t.id
      );
      const f = (await sessionFacts(t.ws.workspace.id)).find(
        (x) => x.id === t.id
      )!;
      expect(f).toMatchObject({ status: "running", activity: "setting up" });
      expect(await lines(t.ws.workspace.id, t.id)).not.toContainEqual(
        expect.stringMatching(/no PR/)
      );
    });
});

describe("a chat task not launched yet", () => {
  it("queues what's sent to it, so nothing starts its agent before the launch", async () => {
    const { sendChat, sendChatConfirmed, sendNowRefusal, sendQueuedNow } =
      await import("@/lib/chat/runner");
    const { listQueue } = await import("@/lib/chat/queued");
    const { firstMessageId } = await import("@/lib/tasks/launch-gate");
    const t = task("chat", { said: "", state: "idle" });
    db.prepare(`UPDATE sessions SET setup_status = 'held' WHERE id = ?`).run(
      t.id
    );
    // Any of these reaching a worker would spawn one: they're queued.
    expect(await sendChatConfirmed(t.id, { text: "from a peer" })).toBe(
      "queued"
    );
    await sendChat(t.id, { text: "typed in its chat" });
    expect(listQueue(t.id).map((m) => m.text)).toEqual([
      "from a peer",
      "typed in its chat",
    ]);
    await expect(sendQueuedNow(t.id, listQueue(t.id)[0].id)).rejects.toThrow(
      /once the task has started/
    );
    // Only the launch's own first message gets through, and once it has
    // launched, anything does.
    expect(sendNowRefusal(t.id, listQueue(t.id)[0].id)).toMatch(/started/);
    expect(sendNowRefusal(t.id, firstMessageId(t.id))).toBeNull();
    db.prepare(`UPDATE sessions SET setup_status = 'ok' WHERE id = ?`).run(
      t.id
    );
    expect(sendNowRefusal(t.id, listQueue(t.id)[0].id)).toBeNull();
  });
});

describe("chat tasks, where they differ from terminal ones", () => {
  it("holds the gate while its chat worker can't be reached", async () => {
    const t = task("chat", { said: "Working", state: "idle" });
    unreachable.add(t.id);
    const w = await waitingState(row(t.id));
    expect(gate(w)).toMatchObject({ state: "fail" });
    expect(w.waitingOn).toMatch(/couldn't be reached/);
    // What it shows meanwhile: busy, as a linked machine's unknown screen.
    expect((await taskView(row(t.id))).state).toBe("working");
  });

  it("stay on this machine", () => {
    const chat = task("chat", { said: "x", state: "idle" });
    const term = task("terminal", { said: "x", state: "idle" });
    expect(moveRefusal(row(chat.id))).toMatch(/Chat tasks run on this machine/);
    expect(moveRefusal(row(term.id))).toBeNull();
  });

  it("get the task brief, with its code review steps, in the chat's system prompt", async () => {
    const brief = buildTaskBrief({ branch: "feature/x", baseBranch: "main" });
    const t = task("chat", { said: "x", state: "idle" });
    db.prepare(`UPDATE sessions SET task_brief = ? WHERE id = ?`).run(
      brief,
      t.id
    );
    const extras = await roleExtras(row(t.id));
    expect(extras.systemAppend).toBe(brief);
    expect(extras.systemAppend).toContain("/do-code-review");
    expect(extras.systemAppend).toContain("## Code review");
    expect(extras.systemAppend).toContain('"BLOCKED:"');
    const ws = seedWorkspace();
    const plain = seedSession({
      projectId: ws.app.id,
      name: "plain",
      view: "chat",
    });
    expect(await roleExtras(row(plain))).toEqual({});
  });
});

describe("the load monitor", () => {
  it("puts a chat's worker and a terminal's pane on their own sessions", () => {
    const rows = [
      { id: "c", name: "chat", tmux_name: "claude-c" },
      { id: "t", name: "term", tmux_name: "claude-t" },
      { id: "x", name: "idle", tmux_name: "claude-x" },
    ];
    const usage = sessionUsage(
      {
        [workerTmuxName("c")]: { cores: 1.24, rssBytes: 100 },
        "claude-t": { cores: 2, rssBytes: 200 },
      },
      rows
    );
    expect(usage.c).toMatchObject({
      sessionId: "c",
      cores: 1.2,
      rssBytes: 100,
    });
    expect(usage.t).toMatchObject({ sessionId: "t", cores: 2, rssBytes: 200 });
    expect(usage.x).toBeUndefined();
  });
});
