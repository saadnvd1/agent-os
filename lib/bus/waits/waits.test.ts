import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { updateSessionRow } from "@/lib/db";

const status = new Map<string, "idle" | "running" | "dead">();
const typed: string[] = [];
let paneResult: import("../delivery").Delivery = { state: "delivered" };

vi.mock("@/lib/status-detector", () => ({
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: (name: string) => status.get(name) !== "dead",
    getStatus: async (name: string) => status.get(name) ?? "idle",
    titleFor: () => "",
  },
}));
vi.mock("@/lib/bus/delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../delivery")>()),
  deliverToPane: async (_pane: unknown, line: string) => {
    typed.push(line);
    return paneResult;
  },
}));
vi.mock("@/lib/chat/runner", () => ({
  sendChatConfirmed: async () => "delivered",
  chatState: () => null,
}));

const { db } = await import("@/lib/db");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { createWorkspace } = await import("@/lib/workspaces");
const bus = await import("..");
const store = await import("./store");
const { waitsTick, IDLE_GRACE_MS } = await import("./tick");
const { registerWait, parseTimeout } = await import("./register");

function setup() {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const tag = randomUUID().slice(0, 6);
  const a = seedSession({
    projectId: project.id,
    name: `a-${tag}`,
    task: true,
  });
  const b = seedSession({
    projectId: project.id,
    name: `b-${tag}`,
    task: true,
  });
  const tmux = (id: string) =>
    (
      db.prepare(`SELECT tmux_name FROM sessions WHERE id = ?`).get(id) as {
        tmux_name: string;
      }
    ).tmux_name;
  return { project, tag, a, b, tmux };
}

const open = (waiter: string) =>
  db
    .prepare(`SELECT * FROM bus_waits WHERE waiter_id = ? ORDER BY id`)
    .all(waiter) as import("./store").WaitRow[];
const told = (to: string) =>
  (
    db
      .prepare(`SELECT body FROM bus_messages WHERE to_id = ? ORDER BY id`)
      .all(to) as { body: string }[]
  ).map((m) => m.body);

describe("send --await and reply correlation", () => {
  it("records a wait; the target's next message closes it and says what it answers", async () => {
    const { a, b } = setup();
    const sent = await bus.sendMessage({
      fromId: a,
      to: b,
      body: "ship the report?",
      awaitMs: 600_000,
    });
    expect(sent.wait).toMatchObject({ id: expect.any(Number) });
    const [w] = open(a);
    expect(w).toMatchObject({
      target_id: b,
      kind: "reply",
      message_id: sent.message.id,
      request: "ship the report?",
      closed_at: null,
    });
    expect(w.deadline).toBeGreaterThan(Date.now() + 590_000);

    typed.length = 0;
    const reply = await bus.sendMessage({ fromId: b, to: a, body: "yes" });
    expect(reply.message.replyTo).toBe(sent.message.id);
    expect(typed.at(-1)).toContain(
      `replying to your #${sent.message.id} ("ship the report?")`
    );
    expect(open(a)[0]).toMatchObject({
      outcome: "replied",
      reply_id: reply.message.id,
    });
  });

  it("--reply names the request, and refuses a message the target didn't send you", async () => {
    const { a, b } = setup();
    const ask = await bus.sendMessage({ fromId: b, to: a, body: "need input" });
    const mine = await bus.sendMessage({
      fromId: a,
      to: b,
      body: "here",
      replyTo: ask.message.id,
    });
    expect(mine.message.replyTo).toBe(ask.message.id);
    await expect(
      bus.sendMessage({ fromId: a, to: b, body: "x", replyTo: mine.message.id })
    ).rejects.toThrow(/wasn't sent to you/);
  });

  it("opens no wait when delivery failed, and keeps the self-send refusal", async () => {
    const { a, b } = setup();
    paneResult = { state: "failed", why: "menu" };
    const r = await bus.sendMessage({
      fromId: a,
      to: b,
      body: "hi",
      awaitMs: 60_000,
    });
    paneResult = { state: "delivered" };
    expect(r.wait).toEqual({ notWaiting: "it wasn't delivered" });
    expect(open(a)).toHaveLength(0);
    await expect(
      bus.sendMessage({ fromId: a, to: a, body: "me", awaitMs: 60_000 })
    ).rejects.toThrow(/itself/);
  });

  it("only a session can wait, and the rate limit still applies", async () => {
    const { a, b } = setup();
    await expect(
      bus.sendMessage({ fromId: null, to: a, body: "x", awaitMs: 60_000 })
    ).rejects.toThrow(/Only a session/);
    for (let i = 0; i < 30; i++)
      db.prepare(
        `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body) VALUES (?, 'a', ?, 'b', 'x')`
      ).run(a, b);
    await expect(
      bus.sendMessage({ fromId: a, to: b, body: "more", awaitMs: 60_000 })
    ).rejects.toThrow(/Too many messages/);
  });

  it("caps open waits per waiter and replaces a repeated one", () => {
    const { a, b } = setup();
    const deadline = Date.now() + 60_000;
    const first = store.openWait({
      waiterId: a,
      targetId: b,
      kind: "reply",
      deadline,
    });
    const again = store.openWait({
      waiterId: a,
      targetId: b,
      kind: "reply",
      deadline,
    });
    expect(again).toBe(first);
    expect(open(a)).toHaveLength(1);
    for (let i = 1; i < store.MAX_OPEN_WAITS; i++)
      store.openWait({
        waiterId: a,
        targetId: randomUUID(),
        kind: "idle",
        deadline,
      });
    expect(() =>
      store.openWait({
        waiterId: a,
        targetId: randomUUID(),
        kind: "idle",
        deadline,
      })
    ).toThrow(/waits open/);
  });

  it("claims a close once", () => {
    const { a, b } = setup();
    const id = store.openWait({
      waiterId: a,
      targetId: b,
      kind: "idle",
      deadline: Date.now() + 1000,
    });
    expect(store.claimClose(id, "idle")).toBe(true);
    expect(store.claimClose(id, "timeout")).toBe(false);
    expect(store.claimNudge(id)).toBe(false);
  });
});

describe("the sweep", () => {
  async function awaiting() {
    const s = setup();
    const sent = await bus.sendMessage({
      fromId: s.a,
      to: s.b,
      body: "status?",
      awaitMs: 600_000,
    });
    return { ...s, sent, wait: open(s.a)[0] };
  }

  it("nudges an idle target once, after the grace period", async () => {
    const { a, b, wait } = await awaiting();
    const t0 = wait.created_at;
    await waitsTick(t0 + 1000);
    expect(
      told(b).filter((m) => m.includes("waiting on your reply"))
    ).toHaveLength(0);
    await waitsTick(t0 + IDLE_GRACE_MS + 1000);
    await waitsTick(t0 + IDLE_GRACE_MS + 6000);
    const nudges = told(b).filter((m) => m.includes("waiting on your reply"));
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toContain(`--reply ${wait.message_id}`);
    expect(open(a)[0].closed_at).toBeNull();
  });

  it("nudges at once when the target was seen working and then went idle", async () => {
    const { b, tmux, wait } = await awaiting();
    status.set(tmux(b), "running");
    await waitsTick(wait.created_at + 1000);
    status.delete(tmux(b));
    await waitsTick(wait.created_at + 6000);
    expect(
      told(b).filter((m) => m.includes("waiting on your reply"))
    ).toHaveLength(1);
  });

  it("at the deadline wakes the waiter once and queues one orchestrator event", async () => {
    const { a, wait } = await awaiting();
    const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
    updateSessionRow(db, a, { workspace_id: ws.id });
    await waitsTick(wait.deadline + 1);
    await waitsTick(wait.deadline + 6000);
    const timeouts = told(a).filter((m) => m.includes("No reply from"));
    expect(timeouts).toHaveLength(1);
    expect(open(a)[0].outcome).toBe("timeout");
    const events = db
      .prepare(`SELECT line FROM orchestrator_events WHERE workspace_id = ?`)
      .all(ws.id) as { line: string }[];
    expect(events).toHaveLength(1);
    expect(events[0].line).toContain("waited");
  });

  it("tells the waiter at once when the target ends, and cancels silently when the waiter does", async () => {
    const one = await awaiting();
    updateSessionRow(db, one.b, { task_status: "dropped" });
    await waitsTick();
    const ended = told(one.a).filter((m) => m.includes("ended (dropped)"));
    expect(ended).toHaveLength(1);

    const two = await awaiting();
    const before = told(two.a).length;
    updateSessionRow(db, two.a, { task_status: "done" });
    await waitsTick();
    expect(open(two.a)[0].outcome).toBe("cancelled");
    expect(told(two.a)).toHaveLength(before);
    expect(
      told(two.b).filter((m) => m.includes("waiting on your reply"))
    ).toHaveLength(0);
  });

  it("a terminal that reads dead twice has ended; once is a blip", async () => {
    const { a, b, tmux } = await awaiting();
    status.set(tmux(b), "dead");
    await waitsTick();
    expect(open(a)[0].closed_at).toBeNull();
    await waitsTick();
    expect(open(a)[0].outcome).toBe("ended");
    status.delete(tmux(b));
  });

  it("two sweeps at once wake the waiter once", async () => {
    const { a, b, wait } = await awaiting();
    updateSessionRow(db, b, { task_status: "dropped" });
    await Promise.all([
      waitsTick(wait.created_at + 1),
      waitsTick(wait.created_at + 2),
    ]);
    expect(told(a).filter((m) => m.includes("ended"))).toHaveLength(1);
  });
});

describe("aos wait", () => {
  it("--until idle wakes when the target is idle (after it worked)", async () => {
    const { a, b, tmux } = setup();
    status.set(tmux(b), "running");
    const r = await registerWait({
      fromId: a,
      to: b,
      until: "idle",
      timeout: "10m",
    });
    expect(r.id).toBeTruthy();
    const [w] = open(a);
    await waitsTick(w.created_at + 1000);
    expect(open(a)[0].closed_at).toBeNull();
    status.delete(tmux(b));
    await waitsTick(w.created_at + 6000);
    expect(open(a)[0].outcome).toBe("idle");
    expect(told(a).some((m) => m.includes("is idle now"))).toBe(true);
  });

  it("--until merged follows the target's PR, and a closed PR is told", async () => {
    const { a, b } = setup();
    await registerWait({ fromId: a, to: b, until: "merged" });
    updateSessionRow(db, b, { pr_status: "merged", pr_number: 7 });
    await waitsTick();
    expect(open(a)[0].outcome).toBe("merged");
    expect(told(a).some((m) => m.includes("PR #7 merged"))).toBe(true);
  });

  it("--until reply is settled by any message from the target", async () => {
    const { a, b } = setup();
    await registerWait({ fromId: a, to: b, until: "reply" });
    await bus.sendMessage({ fromId: b, to: a, body: "hello" });
    expect(open(a)[0].outcome).toBe("replied");
  });

  it("answers at once when it already holds, and refuses the impossible", async () => {
    const { a, b, project, tag } = setup();
    expect(
      await registerWait({ fromId: a, to: b, until: "idle" })
    ).toMatchObject({
      already: expect.stringContaining("idle now"),
    });
    updateSessionRow(db, b, { pr_status: "merged" });
    expect(
      await registerWait({ fromId: a, to: b, until: "merged" })
    ).toMatchObject({
      already: expect.stringContaining("already merged"),
    });
    expect(open(a)).toHaveLength(0);
    await expect(
      registerWait({ fromId: a, to: a, until: "idle" })
    ).rejects.toThrow(/itself/);
    await expect(
      registerWait({ fromId: a, to: b, until: "soon" })
    ).rejects.toThrow(/--until/);
    const plain = seedSession({ projectId: project.id, name: `plain-${tag}` });
    await expect(
      registerWait({ fromId: a, to: plain, until: "merged" })
    ).rejects.toThrow(/nothing to merge/);
  });

  it("parses timeouts within 1m..24h", () => {
    expect(parseTimeout(undefined)).toBe(30 * 60_000);
    expect(parseTimeout("2h")).toBe(2 * 3_600_000);
    expect(parseTimeout("1h30m")).toBe(90 * 60_000);
    expect(() => parseTimeout("soon")).toThrow(/Can't read/);
    expect(() => parseTimeout("2d")).toThrow(/between 1m and 24h/);
  });
});

describe("where waits show", () => {
  it("lists them on both sessions in peers and badges", async () => {
    const { a, b } = setup();
    await bus.sendMessage({ fromId: a, to: b, body: "q", awaitMs: 60_000 });
    const peers = await bus.listPeers();
    expect(peers.find((p) => p.id === a)?.waitingOn).toHaveLength(1);
    expect(peers.find((p) => p.id === b)?.waitedBy).toHaveLength(1);
    expect(store.namesLine(["x", "y", "z", "w"])).toBe("x, y +2");
  });
});
