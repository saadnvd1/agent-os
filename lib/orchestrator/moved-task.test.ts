import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fakePeer } from "../__fixtures__/fake-peer";
import { linkedHost } from "../__fixtures__/linked-host";
import { seedWorkspace } from "./testing";

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
