import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import type { ChatServerMessage } from "./events";
import { setChatModel } from "./settings";
import { SESSION_GONE, serveChatSocket } from "./socket";

// Runs inside setChatModel first when set: a session deleted mid-message.
const before = vi.hoisted(() => ({ setModel: null as null | (() => void) }));
vi.mock("./settings", async (importOriginal) => {
  const real = await importOriginal<typeof import("./settings")>();
  return {
    ...real,
    setChatModel: async (id: string, model: string) => {
      before.setModel?.();
      return real.setChatModel(id, model);
    },
  };
});

function session() {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id) VALUES (?, 'chat', ?, '/tmp', 'remote')`
    )
    .run(id, `claude-${id}`);
  return id;
}
const remove = (id: string) =>
  getDb().prepare(`DELETE FROM sessions WHERE id = ?`).run(id);

class FakeSocket extends EventEmitter {
  closedWith: [number?, string?] | null = null;
  close(code?: number, reason?: string) {
    this.closedWith = [code, reason];
  }
  message(m: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(m)));
  }
}

function open(sessionId: string, demo = false) {
  const ws = new FakeSocket();
  const sent: ChatServerMessage[] = [];
  serveChatSocket(
    ws,
    new URLSearchParams({ session: sessionId }),
    (json) => sent.push(JSON.parse(json)),
    demo
  );
  return { ws, sent };
}

const errors = (sent: ChatServerMessage[]) =>
  sent.flatMap((m) =>
    m.type === "item" && m.item.kind === "error" ? [m.item.message] : []
  );

const logged = (log: { mock: { calls: unknown[][] } }, id: string) =>
  log.mock.calls.some((c) => String(c[0]).includes(id));

// The crash: these rejected with nothing to catch them.
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("/ws/chat after its session is deleted", () => {
  const rejections: unknown[] = [];
  const onRejection = (e: unknown) => void rejections.push(e);
  process.on("unhandledRejection", onRejection);
  afterEach(() => {
    rejections.length = 0;
    before.setModel = null;
  });

  it("the settings calls reject on a deleted session (what crashed the server)", async () => {
    const id = session();
    remove(id);
    await expect(setChatModel(id, "opus")).rejects.toThrow("Session not found");
  });

  it.each([
    { type: "set_model", model: "opus" },
    { type: "set_access", access: "full" },
    { type: "set_plan", plan: true },
    { type: "interrupt" },
    { type: "send", text: "hi" },
    { type: "queue_delete", id: "x" },
    { type: "history", before: 1 },
    { type: "tool_body", id: "x" },
    { type: "undo", from: "x", dryRun: true },
  ])("$type replies with an error and closes the socket", async (msg) => {
    const id = session();
    const { ws, sent } = open(id);
    expect(sent[0]?.type).toBe("snapshot");
    remove(id);
    ws.message(msg);
    ws.message(msg);
    await settle();
    expect(errors(sent)).toEqual(["This session no longer exists"]);
    expect(ws.closedWith).toEqual([SESSION_GONE, "session not found"]);
    expect(rejections).toEqual([]);
  });

  it("closes a socket opened for a session that no longer exists", async () => {
    const id = session();
    remove(id);
    const { ws, sent } = open(id);
    await settle();
    expect(errors(sent)).toEqual(["This session no longer exists"]);
    expect(ws.closedWith?.[0]).toBe(SESSION_GONE);
    expect(rejections).toEqual([]);
  });

  it("closes when the session goes away while a message is in flight", async () => {
    const id = session();
    const { ws, sent } = open(id);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // Deleted after the message's check, before the setting is saved.
    before.setModel = () => remove(id);
    ws.message({ type: "set_model", model: "opus" });
    await settle();
    expect(errors(sent)).toEqual(["This session no longer exists"]);
    expect(ws.closedWith?.[0]).toBe(SESSION_GONE);
    expect(rejections).toEqual([]);
    expect(logged(log, id)).toBe(true);
  });

  it("an error from the closing socket isn't thrown", () => {
    const id = session();
    remove(id);
    const { ws } = open(id);
    expect(ws.listenerCount("error")).toBeGreaterThan(0);
    expect(() => ws.emit("error", new Error("bad frame"))).not.toThrow();
    const noSession = new FakeSocket();
    serveChatSocket(noSession, new URLSearchParams(), () => {});
    expect(() => noSession.emit("error", new Error("x"))).not.toThrow();
  });
});

describe("/ws/chat message failures", () => {
  afterEach(() => {
    before.setModel = null;
    vi.restoreAllMocks();
  });

  it("logs a bad message with the session id and keeps the socket open", async () => {
    const id = session();
    const { ws, sent } = open(id);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    ws.emit("message", Buffer.from("not json"));
    await settle();
    expect(logged(log, id)).toBe(true);
    expect(errors(sent)).toEqual([expect.stringMatching(/JSON/)]);
    expect(ws.closedWith).toBeNull();
  });

  it("reports a failed setting on a live session and keeps the socket open", async () => {
    const id = session();
    const { ws, sent } = open(id);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    before.setModel = () => {
      throw new Error("boom");
    };
    ws.message({ type: "set_model", model: "opus" });
    await settle();
    expect(errors(sent)).toEqual(["boom"]);
    expect(logged(log, id)).toBe(true);
    expect(ws.closedWith).toBeNull();
  });
});

describe("/ws/chat in demo mode", () => {
  const access = (id: string) =>
    (
      getDb()
        .prepare(`SELECT chat_access FROM sessions WHERE id = ?`)
        .get(id) as { chat_access: string }
    ).chat_access;

  it("refuses changes and still answers reads", () => {
    const id = session();
    const { ws, sent } = open(id, true);
    const was = access(id);
    ws.message({ type: "set_access", access: "full" });
    expect(access(id)).toBe(was);
    expect(errors(sent)).toHaveLength(1);
    ws.message({ type: "history", before: 1 });
    expect(sent.at(-1)?.type).toBe("history");
  });
});

describe("/ws/chat for a linked machine's session", () => {
  it("is served by that machine's AgentOS, not run here", async () => {
    const { fakePeer, until } = await import("../__fixtures__/fake-peer");
    const peer = await fakePeer("tok");
    peer.onSocket(({ ws }) =>
      ws.send(JSON.stringify({ type: "snapshot", items: [], state: "idle" }))
    );
    const hostId = randomUUID();
    const db = getDb();
    db.prepare(
      `INSERT INTO hosts (id, name, ssh_target) VALUES (?, 'box', 'me@box')`
    ).run(hostId);
    db.prepare(
      `INSERT INTO host_links (host_id, url, token) VALUES (?, ?, 'tok')`
    ).run(hostId, peer.url);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id, view) VALUES (?, 'c', ?, '/tmp', ?, 'chat')`
    ).run(id, `claude-${id}`, hostId);
    try {
      const { ws, sent } = open(id);
      await until(() => sent.length === 1);
      expect(sent[0].type).toBe("snapshot");
      expect(peer.sockets[0].url.searchParams.get("session")).toBe(id);
      ws.message({ type: "interrupt" });
      await until(() => peer.sockets[0].got.length === 1);
      expect(peer.sockets[0].got[0]).toEqual({ type: "interrupt" });
      ws.emit("close");
    } finally {
      remove(id);
      db.prepare(`DELETE FROM hosts WHERE id = ?`).run(hostId);
      await peer.close();
    }
  });

  it("an unlinked machine's chat is refused, saying to link it", async () => {
    const id = session();
    const { ws, sent } = open(id);
    ws.message({ type: "send", text: "hello" });
    await new Promise((r) => setTimeout(r, 50));
    expect(errors(sent).join(" ")).toContain("isn't linked");
    remove(id);
  });
});
