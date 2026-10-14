import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/status-detector", () => ({
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => false,
    getStatus: async () => "dead",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    foregroundFor: () => undefined,
    paneProcess: () => undefined,
    capturePane: async () => "",
  },
}));

const { db } = await import("@/lib/db");
const { seedWorkspace } = await import("@/lib/orchestrator/testing");
const { ensureOrchestrator } = await import("@/lib/orchestrator/home");
const { send } = await import("@/lib/orchestrator/act");
const { amendmentsOf } = await import("@/lib/orchestrator/amendments");
const { sendMessage } = await import("@/lib/bus");
const { listQueue, removeQueued } = await import("./queue");
const { queuedHeldMessages } = await import("./queue-held");

let ws: ReturnType<typeof seedWorkspace>;
let peer: string;
beforeEach(() => {
  ws = seedWorkspace();
  peer = ws.chat;
});

function queued(name: string, projectId = ws.app.id): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO task_queue (id, project_id, prompt, name, position) VALUES (?, ?, 'the brief', ?, 1)`
  ).run(id, projectId, name);
  return id;
}

const heldRows = (id: string) =>
  db
    .prepare(`SELECT * FROM bus_messages WHERE to_id = ? AND held_queued = 1`)
    .all(id) as { delivered_at: string | null; read_at: string | null }[];

describe("messages to a queued task", () => {
  it("are held by id, id prefix and name, and say so", async () => {
    const id = queued("fix login");
    for (const to of [id, id.slice(0, 8), "fix login", "FIX LOGIN"]) {
      const out = await sendMessage({ fromId: null, to, body: `via ${to}` });
      expect(out.delivery.state).toBe("queued");
      expect(out.heldForQueued).toBe(true);
      expect(out.note).toBe(
        "Queued for fix login: it hasn't started; it gets this when it starts."
      );
    }
    const rows = heldRows(id);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => !r.delivered_at && !r.read_at)).toBe(true);
    expect(queuedHeldMessages(id).map((m) => m.text)[0]).toBe(`via ${id}`);
    expect(listQueue().find((q) => q.id === id)?.held).toBe(4);
  });

  it("still fail for a name nothing has, and for a failed start", async () => {
    await expect(
      sendMessage({ fromId: null, to: "nobody", body: "hi" })
    ).rejects.toThrow(/No session called "nobody"/);
    const id = queued("broken");
    db.prepare(
      `UPDATE task_queue SET status = 'failed', error = 'no disk' WHERE id = ?`
    ).run(id);
    await expect(
      sendMessage({ fromId: null, to: "broken", body: "hi" })
    ).rejects.toThrow(/failed to start/);
  });

  it("are dropped with the queued task", async () => {
    const id = queued("short lived");
    await sendMessage({ fromId: null, to: id, body: "one" });
    await sendMessage({ fromId: peer, to: id, body: "two" });
    removeQueued(id);
    expect(queuedHeldMessages(id)).toEqual([]);
    expect(heldRows(id).every((r) => r.read_at && !r.delivered_at)).toBe(true);
    expect(listQueue().find((q) => q.id === id)).toBeUndefined();
  });

  it("reach the orchestrator's send, and scope_change lands on the brief at once", async () => {
    ensureOrchestrator(ws.workspace.id);
    const id = queued("add export");
    const plain = await send(ws.workspace.id, "add export", "use CSV");
    expect(plain).toBe(
      "Queued for add export: it hasn't started; it gets this when it starts."
    );
    const scoped = await send(ws.workspace.id, id.slice(0, 8), "also JSON", {
      scopeChange: true,
    });
    expect(scoped).toContain("Queued for add export");
    expect(scoped).toContain("scope change 1");
    expect(amendmentsOf(id).map((a) => a.text)).toEqual(["also JSON"]);
    expect(queuedHeldMessages(id).map((m) => m.text)).toEqual([
      "use CSV",
      "also JSON",
    ]);
  });

  it("are not reachable from another workspace's orchestrator", async () => {
    const other = seedWorkspace();
    ensureOrchestrator(other.workspace.id);
    queued("private job");
    await expect(send(other.workspace.id, "private job", "hi")).rejects.toThrow(
      /No session "private job"/
    );
  });
});
