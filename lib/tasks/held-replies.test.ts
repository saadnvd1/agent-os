import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

const hostApi = vi.hoisted(() => vi.fn());
vi.mock("../hosts/remote-api", async (orig) => ({
  ...(await orig<typeof import("../hosts/remote-api")>()),
  hostApi,
}));
const sent = vi.hoisted(
  () => [] as { text: string; from?: string; origin?: unknown }[]
);
vi.mock("../chat/runner", async (orig) => ({
  ...(await orig<typeof import("../chat/runner")>()),
  sendChatConfirmed: async (
    _id: string,
    m: { text: string; from?: string; origin?: unknown }
  ) => {
    sent.push(m);
    return "sent";
  },
}));

const { db } = await import("../db");
const { DEVICE_HEADER } = await import("../security/auth");
const { sendMessage, listPeers, resolveHeldOrchestrator } =
  await import("../bus");
const { GET, POST } = await import("@/app/api/tasks/held-replies/route");
const { pullHeldReplies } = await import("./held-replies");
const { createHost } = await import("../hosts");
const link = {
  hostId: createHost("box-r", "alice@box-r").id,
  hostName: "box-r",
  url: "http://box:3011",
  token: "t",
};

const orchId = randomUUID();

// A task held here for dev-1, whose orchestrator is "The Boss" elsewhere.
function held(opts: { device?: string; status?: string } = {}) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, view, task_status,
       held_by_device, held_from, held_for, held_for_name, task_prompt)
     VALUES (?, 'held-task', ?, '/tmp', 'chat', ?, ?, 'the Mac', ?, 'The Boss', 'x')`
  ).run(
    id,
    `claude-${id}`,
    opts.status ?? "running",
    opts.device ?? "dev-1",
    orchId
  );
  return id;
}
const pending = () =>
  db
    .prepare(
      `SELECT * FROM bus_messages WHERE relay_state IS NOT NULL ORDER BY id`
    )
    .all() as { id: number; to_id: string; relay_state: string }[];
const req = (method: string, device: string | null, body?: object) =>
  new NextRequest("http://x/api/tasks/held-replies", {
    method,
    headers: device ? { [DEVICE_HEADER]: device } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => {
  db.prepare(`DELETE FROM bus_messages`).run();
  sent.length = 0;
  hostApi.mockReset();
});

describe("a held task messaging its orchestrator (the machine it runs on)", () => {
  it("stores the message for the holder instead of delivering it", async () => {
    const id = held();
    const { delivery, note, message } = await sendMessage({
      fromId: id,
      to: orchId.slice(0, 8),
      body: "need a decision",
    });
    expect(delivery.state).toBe("queued");
    expect(note).toMatch(/The Boss runs on the Mac/);
    expect(message.toId).toBe(orchId);
    expect(pending()).toMatchObject([
      { to_id: orchId, relay_state: "pending" },
    ]);
    expect(sent).toEqual([]);
  });

  it("takes the orchestrator's name or 'orchestrator', and nothing else", async () => {
    const id = held();
    await sendMessage({ fromId: id, to: "The Boss", body: "a" });
    await sendMessage({ fromId: id, to: "orchestrator", body: "b" });
    expect(pending()).toHaveLength(2);
    await expect(
      sendMessage({ fromId: id, to: "somebody-else", body: "c" })
    ).rejects.toThrow(/No session/);
  });

  it("is not available to a task that isn't held, or isn't running", async () => {
    const plain = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'plain', ?, '/tmp')`
    ).run(plain, `claude-${plain}`);
    await expect(
      sendMessage({ fromId: plain, to: orchId, body: "x" })
    ).rejects.toThrow(/No session/);
    const done = held({ status: "moved" });
    await expect(
      sendMessage({ fromId: done, to: orchId, body: "x" })
    ).rejects.toThrow(/No session/);
  });

  it("lists the orchestrator for the held task only", async () => {
    const id = held();
    expect((await listPeers(id)).map((p) => p.id)).toContain(orchId);
    expect((await listPeers()).map((p) => p.id)).not.toContain(orchId);
    expect(resolveHeldOrchestrator(id, "the boss")?.id).toBe(orchId);
    expect(resolveHeldOrchestrator(id, "nobody")).toBeNull();
  });
});

describe("the holder pulling those messages", () => {
  it("offers a device only its own tasks' messages, and acks only its own", async () => {
    const mine = held({ device: "dev-1" });
    const other = held({ device: "dev-2" });
    await sendMessage({ fromId: mine, to: "orchestrator", body: "mine" });
    await sendMessage({ fromId: other, to: "orchestrator", body: "theirs" });

    const got = await (await GET(req("GET", "dev-1"))).json();
    expect(got.messages.map((m: { body: string }) => m.body)).toEqual(["mine"]);
    expect((await GET(req("GET", null))).status).toBe(403);

    const ids = pending().map((m) => m.id);
    await POST(req("POST", "dev-1", { ids }));
    expect(pending().map((m) => m.relay_state)).toEqual(["relayed", "pending"]);
    expect((await (await GET(req("GET", "dev-1"))).json()).messages).toEqual(
      []
    );
  });
});

describe("the orchestrator's machine pulling them", () => {
  const orchestrator = () => {
    db.prepare(
      `INSERT OR IGNORE INTO sessions (id, name, tmux_name, working_directory, role, view) VALUES (?, 'The Boss', ?, '/tmp', 'orchestrator', 'chat')`
    ).run(orchId, `claude-${orchId}`);
  };
  const mirror = () => {
    orchestrator();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, view, task_status,
         host_id, started_by, task_prompt)
       VALUES (?, 'moved-task', ?, '/tmp', 'chat', 'running', ?, ?, 'x')`
    ).run(id, `claude-${id}`, link.hostId, orchId);
    return id;
  };
  const freshLink = () => ({ ...link, hostId: link.hostId });

  it("delivers a pulled message to the mirror's orchestrator as the task's own, once", async () => {
    const id = mirror();
    const answer = {
      messages: [{ id: 41, fromId: id, body: "need a decision" }],
    };
    hostApi.mockImplementation(async (_l, _p, o) =>
      o?.body ? { success: true } : answer
    );
    expect(await pullHeldReplies(freshLink())).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: "moved-task",
      origin: { kind: "peer", sessionId: id },
    });
    expect(sent[0].text).toContain("need a decision");
    expect(hostApi).toHaveBeenLastCalledWith(
      expect.anything(),
      "/api/tasks/held-replies",
      expect.objectContaining({ body: { ids: [41] } })
    );
    // The ack was lost: the same message comes again and isn't delivered twice.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_000);
    expect(await pullHeldReplies(freshLink())).toBe(1);
    vi.useRealTimers();
    expect(sent).toHaveLength(1);
  });

  it("ignores a message from a task that isn't its held mirror, and never reaches out for nothing", async () => {
    mirror();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    hostApi.mockImplementation(async (_l, _p, o) =>
      o?.body
        ? { success: true }
        : { messages: [{ id: 7, fromId: randomUUID(), body: "x" }] }
    );
    expect(await pullHeldReplies(freshLink())).toBe(0);
    vi.useRealTimers();
    expect(sent).toEqual([]);
    expect(hostApi).toHaveBeenLastCalledWith(
      expect.anything(),
      "/api/tasks/held-replies",
      expect.objectContaining({ body: { ids: [7] } })
    );

    db.prepare(`DELETE FROM sessions WHERE host_id = ?`).run(link.hostId);
    hostApi.mockReset();
    expect(await pullHeldReplies({ ...link, hostId: "nobody" })).toBe(0);
    expect(hostApi).not.toHaveBeenCalled();
  });
});
