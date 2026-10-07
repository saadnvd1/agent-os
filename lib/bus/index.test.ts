import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";

let paneResult: import("./delivery").Delivery = { state: "delivered" };
const typed: string[] = [];

vi.mock("@/lib/status-detector", () => ({
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => true,
    getStatus: async () => "idle",
    titleFor: () => "",
  },
}));
vi.mock("@/lib/bus/delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./delivery")>()),
  deliverToPane: async (_pane: unknown, line: string) => {
    typed.push(line);
    return paneResult;
  },
}));

const { db } = await import("@/lib/db");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { recordPreviousName } = await import("@/lib/session-names");
const bus = await import(".");

function rename(id: string, name: string) {
  const old = db.prepare(`SELECT name FROM sessions WHERE id = ?`).get(id) as {
    name: string;
  };
  recordPreviousName(id, old.name);
  db.prepare(`UPDATE sessions SET name = ? WHERE id = ?`).run(name, id);
}

function setup() {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const tag = randomUUID().slice(0, 6);
  const sender = seedSession({ projectId: project.id, name: `sender-${tag}` });
  const target = seedSession({ projectId: project.id, name: `Session ${tag}` });
  return { project, tag, sender, target };
}

describe("the bus after a rename", () => {
  it("reaches a renamed session by its old name, stored and replied to by id", async () => {
    const { tag, sender, target } = setup();
    rename(target, `orchestrator-${tag}`);
    const sent = await bus.sendMessage({
      fromId: sender,
      to: `Session ${tag}`,
      body: "status?",
    });
    expect(sent.delivery).toEqual({ state: "delivered" });
    expect(sent.note).toBe(
      `"Session ${tag}" was renamed to "orchestrator-${tag}"`
    );
    expect(sent.message.toId).toBe(target);
    expect(typed.at(-1)).toContain(`aos send ${sender.slice(0, 8)} `);

    // The sender renamed too: its message shows its name now, by id.
    rename(sender, `renamed-${tag}`);
    const [inbox] = bus.readInbox(target);
    expect(inbox).toMatchObject({
      fromId: sender,
      fromName: `renamed-${tag}`,
      toName: `orchestrator-${tag}`,
    });

    const peer = (await bus.listPeers()).find((p) => p.id === target);
    expect(peer).toMatchObject({
      name: `orchestrator-${tag}`,
      was: `Session ${tag}`,
    });
  });

  it("keeps a failed delivery unmarked so it waits in the inbox", async () => {
    const { sender, target } = setup();
    paneResult = { state: "failed", why: "it is showing a menu" };
    try {
      const sent = await bus.sendMessage({
        fromId: sender,
        to: target.slice(0, 8),
        body: "hello",
      });
      expect(sent.delivery).toEqual({
        state: "failed",
        why: "it is showing a menu",
      });
      const row = db
        .prepare(`SELECT delivered_at FROM bus_messages WHERE id = ?`)
        .get(sent.message.id);
      expect(row).toEqual({ delivered_at: null });
      expect(bus.readInbox(target).map((m) => m.body)).toEqual(["hello"]);
    } finally {
      paneResult = { state: "delivered" };
    }
  });

  it("refuses a name two live sessions share", async () => {
    const { project, tag, sender } = setup();
    seedSession({ projectId: project.id, name: `twin-${tag}` });
    seedSession({ projectId: project.id, name: `twin-${tag}` });
    await expect(
      bus.sendMessage({ fromId: sender, to: `twin-${tag}`, body: "hi" })
    ).rejects.toThrow(/matches 2 sessions/);
  });
});
