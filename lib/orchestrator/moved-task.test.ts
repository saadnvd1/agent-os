import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fakePeer } from "../__fixtures__/fake-peer";
import { linkedHost } from "../__fixtures__/linked-host";
import { seedOrchestrator, seedWorkspace } from "./testing";

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
    foregroundFor: () => "",
    paneProcess: () => 0,
  },
}));
vi.mock("@/lib/tasks/gh", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks/gh")>()),
  run: async () => "",
  findPR: async () => null,
}));

const TOKEN = "device-token";
const { db } = await import("@/lib/db");
const { forgetHostTasks } = await import("@/lib/tasks/remote");
const { sessionFacts } = await import("./facts");
const { waitingState } = await import("./task-state");
const { pendingEvents } = await import("./events");

let peer: Awaited<ReturnType<typeof fakePeer>>;
let host: ReturnType<typeof linkedHost>;
let view: Record<string, unknown> = {};
beforeAll(async () => {
  peer = await fakePeer(TOKEN);
  host = linkedHost(peer.url, TOKEN);
  peer.routes["/api/tasks"] = () => ({
    tasks: [view],
    capabilities: ["chat-turn", "orchestrated-move"],
  });
});
afterAll(async () => {
  host.remove();
  await peer.close();
});

// The mirror of a task that moved to the box, as the Mac keeps it.
function mirror(over = "") {
  const ws = seedWorkspace();
  seedOrchestrator("orch");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, view,
       task_status, task_prompt, host_id, peer_mirror, started_by, branch_name)
     VALUES (?, 'moved-one', ?, '/tmp', ?, 'chat', 'running', 'x', ?, 0, 'orch', 'feature/m')`
  ).run(id, `claude-${id}`, ws.api.id, host.hostId);
  if (over) db.prepare(`UPDATE sessions SET ${over} WHERE id = ?`).run(id);
  view = { id, state: "running", chatTurn: "idle" };
  forgetHostTasks(host.hostId);
  const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id);
  return { id, ws, session: session as never };
}

describe("a task running on a linked machine", () => {
  it("holds the blocked gate on a BLOCKED line or an open approval in its chat there", async () => {
    const m = mirror();
    expect(await waitingState(m.session)).toEqual({
      blocked: null,
      waitingOn: null,
    });
    view = { ...view, blocked: "BLOCKED: need the API key" };
    forgetHostTasks(host.hostId);
    expect((await waitingState(m.session)).blocked).toMatch(/need the API key/);
    view = { id: m.id, state: "running", chatTurn: "waiting" };
    forgetHostTasks(host.hostId);
    expect((await waitingState(m.session)).waitingOn).toMatch(/approval/);
  });

  it("can't be read as clear when the machine won't say", async () => {
    const m = mirror();
    view = { id: m.id };
    forgetHostTasks(host.hostId);
    expect((await waitingState(m.session)).blocked).toMatch(
      /can't be ruled out/
    );
  });

  it("tells the orchestrator of a plan written there once, and its idle time from there", async () => {
    const m = mirror();
    view = {
      id: m.id,
      state: "running",
      chatTurn: "idle",
      planNote: "Plan written: 3 steps",
      lastActiveAt: 1234,
    };
    forgetHostTasks(host.hostId);
    const facts = await sessionFacts(m.ws.workspace.id);
    const mine = facts.find((f) => f.id === m.id);
    expect(mine?.lastActive).toBe(1234);
    await sessionFacts(m.ws.workspace.id);
    forgetHostTasks(host.hostId);
    await sessionFacts(m.ws.workspace.id);
    const plans = pendingEvents(m.ws.workspace.id).filter((e) =>
      e.key.includes("plan-done")
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].line).toBe("Plan written: 3 steps");
  });
});

describe("a task its orchestrator moved to a linked machine", () => {
  const chat = (turns: number) =>
    Array.from(
      { length: turns },
      (_, i) => `[assistant] turn ${i} ${"x".repeat(180)}\n[turn ended]`
    ).join("\n");

  it("is read whole: every recent turn, with its lines, not the first 300 characters", async () => {
    const { readSession } = await import("./read");
    const m = mirror("peer_mirror = 0");
    peer.routes[`/api/tasks/${m.id}/chat-tail`] = () => ({ text: chat(5) });
    const out = await readSession(m.ws.workspace.id, m.id, 60);
    expect(out).toContain("chat on");
    for (let i = 0; i < 5; i++) expect(out).toContain(`turn ${i} `);
    expect(out.split("\n").length).toBeGreaterThan(8);
    expect(out.length).toBeGreaterThan(900);
  });

  it("asks its chat facts directly, so a slow task list can't block it", async () => {
    const m = mirror();
    view = { id: m.id }; // the list can't say anything useful
    forgetHostTasks(host.hostId);
    peer.routes[`/api/tasks/${m.id}/chat-facts`] = () => ({
      blocked: null,
      turn: "idle",
    });
    expect(await waitingState(m.session)).toEqual({
      blocked: null,
      waitingOn: null,
    });
    peer.routes[`/api/tasks/${m.id}/chat-facts`] = () => ({
      blocked: "BLOCKED: need the key\nsecond line",
      turn: "waiting",
    });
    const w = await waitingState(m.session);
    expect(w.blocked).toMatch(/need the key\nsecond line/);
    expect(w.waitingOn).toMatch(/approval or question/);
  });

  it("is still not cleared when neither the facts nor the list can be read", async () => {
    const m = mirror();
    view = { id: m.id };
    forgetHostTasks(host.hostId);
    delete peer.routes[`/api/tasks/${m.id}/chat-facts`];
    expect((await waitingState(m.session)).blocked).toMatch(
      /can't be ruled out/
    );
  });
});
