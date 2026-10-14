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
vi.mock("@/lib/tasks/project-ref", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks/project-ref")>()),
  projectRef: async () => ({ name: "p", path: "p", remote: null }),
}));

let openPR: Record<string, unknown> | null = null;
vi.mock("@/lib/tasks/pr-poll", () => ({
  lookupPR: async () => openPR,
}));

const TOKEN = "device-token";
const { db } = await import("@/lib/db");
const { forgetHostTasks, startRemoteTask } = await import("@/lib/tasks/remote");
const { isHeldRemote } = await import("@/lib/tasks/held-remote");
const { readSession } = await import("./read");
const { waitingState } = await import("./task-state");
const { sendMessage } = await import("@/lib/bus");
const { diffWorkspace } = await import("./watcher");
const { pendingEvents } = await import("./events");
const { getProject } = await import("@/lib/projects");

let peer: Awaited<ReturnType<typeof fakePeer>>;
let host: ReturnType<typeof linkedHost>;
let capabilities = ["chat-turn", "orchestrated-move", "held-start"];
beforeAll(async () => {
  peer = await fakePeer(TOKEN);
  host = linkedHost(peer.url, TOKEN);
  peer.routes["/api/tasks"] = ({ method, body }) =>
    method === "POST"
      ? {
          session: {
            id: (body as { id: string }).id,
            name: "placed",
            tmux_name: "claude-x",
            working_directory: "/tmp",
            view: "chat",
            branch_name: "feature/placed",
            task_prompt: "x",
          },
        }
      : { tasks: [], capabilities };
});
afterAll(async () => {
  host.remove();
  await peer.close();
});

// A task the queue placed on the linked machine, started by an orchestrator.
async function placed() {
  const ws = seedWorkspace();
  const orch = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, role)
     VALUES (?, 'the-orch', ?, '/tmp', ?, 'orchestrator')`
  ).run(orch, `claude-${orch}`, ws.api.id);
  const id = randomUUID();
  forgetHostTasks(host.hostId);
  await startRemoteTask(host.hostId, getProject(ws.api.id)!, {
    id,
    prompt: "do it",
    view: "chat",
    startedBy: orch,
  });
  return { id, orch, ws };
}
const row = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as never;

describe("a task the queue placed on a linked machine", () => {
  it("asks that machine to hold it for its orchestrator, and is recorded like a moved one", async () => {
    const t = await placed();
    const post = peer.calls.find(
      (c) => c.method === "POST" && c.path === "/api/tasks"
    )!;
    expect(
      (post.body as { orchestrated: { orchestrator: unknown } }).orchestrated
        .orchestrator
    ).toEqual({ id: t.orch, name: "the-orch" });
    const s = row(t.id) as { started_by: string; task_since: string };
    expect(s.started_by).toBe(t.orch);
    expect(s.task_since).toBeTruthy();
    expect(isHeldRemote(s as never)).toBe(true);
  });

  it("is refused on a machine that can't hold it", async () => {
    capabilities = ["chat-turn"];
    forgetHostTasks(host.hostId);
    await expect(placed()).rejects.toThrow(/update it first/);
    capabilities = ["chat-turn", "orchestrated-move", "held-start"];
  });

  it("is read through that machine's chat-tail, as a moved task is", async () => {
    const t = await placed();
    peer.routes[`/api/tasks/${t.id}/chat-tail`] = () => ({
      text: "hello\nbye",
    });
    const out = await readSession(t.ws.workspace.id, t.id, 20);
    expect(out).toContain("hello");
    expect(out).not.toMatch(/open it to read them/);
  });

  it("is messaged through that machine, keyed by the stored message", async () => {
    const t = await placed();
    peer.routes[`/api/tasks/${t.id}/message`] = () => ({ state: "delivered" });
    const out = await sendMessage({ fromId: null, to: t.id, body: "status?" });
    expect(out.delivery.state).toBe("delivered");
    const call = peer.calls.filter((c) => c.path.endsWith(`${t.id}/message`));
    expect((call[0].body as { id: string }).id).toMatch(/^bus-\d+$/);
  });

  it("is sent a long message whole, since that machine's inbox never held it", async () => {
    const t = await placed();
    peer.routes[`/api/tasks/${t.id}/message`] = () => ({ state: "delivered" });
    const body = "fix the review findings. ".repeat(60).trim();
    await sendMessage({ fromId: null, to: t.id, body });
    const call = peer.calls.filter((c) => c.path.endsWith(`${t.id}/message`));
    const line = (call.at(-1)!.body as { line: string }).line;
    expect(line).toContain(body);
    expect(line).not.toContain("aos inbox");
  });

  it("asks its chat facts directly", async () => {
    const t = await placed();
    peer.routes[`/api/tasks/${t.id}/chat-facts`] = () => ({
      blocked: null,
      turn: "idle",
    });
    expect(await waitingState(row(t.id))).toEqual({
      blocked: null,
      waitingOn: null,
    });
  });

  it("is held after the fact when it started unheld, and sends what was stranded", async () => {
    const t = await placed();
    let held = false;
    const sent: string[] = [];
    peer.routes[`/api/tasks/${t.id}/hold`] = () => {
      held = true;
      return { held: true };
    };
    peer.routes[`/api/tasks/${t.id}/message`] = ({ body }) => {
      if (!held) return { $status: 404, error: "No such held task" };
      sent.push((body as { id: string }).id);
      return { state: "delivered" };
    };
    // Sent while it couldn't be reached: stored, never delivered.
    db.prepare(
      `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body) VALUES (NULL, 'saad', ?, 'placed', 'earlier')`
    ).run(t.id);
    const out = await sendMessage({ fromId: null, to: t.id, body: "now" });
    expect(held).toBe(true);
    expect(out.delivery.state).toBe("delivered");
    expect(new Set(sent).size).toBe(2);
    const undelivered = db
      .prepare(
        `SELECT COUNT(*) AS n FROM bus_messages WHERE to_id = ? AND delivered_at IS NULL`
      )
      .get(t.id) as { n: number };
    expect(undelivered.n).toBe(0);
  });

  it("reaches its orchestrator with PR opened and CI events, and can be woken", async () => {
    const t = await placed();
    peer.routes[`/api/tasks/${t.id}/chat-facts`] = () => ({
      blocked: null,
      turn: "idle",
    });
    // Seen first without a PR (a subject's first look is known state).
    await diffWorkspace(t.ws.workspace.id, t.orch);
    // The PR list is cached for a short while.
    const real = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(real + 5 * 60_000);
    openPR = {
      number: 305,
      url: "https://github.com/o/r/pull/305",
      state: "OPEN",
      checks: "fail",
      head: "abc1234",
      failing: "test",
    };
    forgetHostTasks(host.hostId);
    // An event is held on two diffs before it is sent, as for any task.
    await diffWorkspace(t.ws.workspace.id, t.orch);
    await diffWorkspace(t.ws.workspace.id, t.orch);
    const keys = pendingEvents(t.ws.workspace.id).map((e) => e.line);
    expect(keys.some((l) => /PR #305 opened/.test(l))).toBe(true);
    expect(keys.some((l) => /fail/i.test(l))).toBe(true);
    // The wake-up an orchestrator sends it (CI failed) goes through the machine.
    peer.routes[`/api/tasks/${t.id}/message`] = () => ({ state: "delivered" });
    const out = await sendMessage({
      fromId: t.orch,
      to: t.id,
      body: "CI failed on your PR",
    });
    expect(out.delivery.state).toBe("delivered");
    openPR = null;
    clock.mockRestore();
  });
});
