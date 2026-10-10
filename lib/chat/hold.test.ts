import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({
  states: [] as (string | null | Error)[],
  stopped: [] as string[],
}));
vi.mock("./worker/client", async (orig) => ({
  ...(await orig<typeof import("./worker/client")>()),
  waitForExit: vi.fn(async () => {}),
  runningWorkers: () => [],
}));

import { db, stackQueries as q } from "../db";
import { seedStack } from "../stacks/testing";
import { chatHold } from "./hold";
import { claimNext, enqueue, listQueue } from "./queued";
import { sendChat, sendNowRefusal } from "./runner";
import { stopChatAtTurnEnd } from "./stop";
import * as runner from "./runner";

function chatSession(status = "running"): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status, view, moved_to)
     VALUES (?, 'chat', ?, '/tmp', ?, 'chat', ?)`
  ).run(id, `claude-${id}`, status, status === "moved" ? "box" : null);
  return id;
}

const queued = (id: string, text: string) =>
  enqueue(id, { id: `user-${randomUUID()}`, text });

describe("a held chat", () => {
  it("keeps its queue while its task is moving, and lets it go after", () => {
    const id = chatSession("moving");
    queued(id, "wait for me");
    expect(chatHold(id)).toMatch(/move/);
    // The worker's own drain, at a turn's end, takes nothing.
    expect(claimNext(id)).toBeNull();
    db.prepare(`UPDATE sessions SET task_status = 'running' WHERE id = ?`).run(
      id
    );
    expect(chatHold(id)).toBeNull();
    expect(claimNext(id)?.text).toBe("wait for me");
  });

  it("keeps its queue while its stack is landing", () => {
    const s = seedStack(mkdtempSync(join(tmpdir(), "hold-")), [
      { key: "P", status: "pr", branch: "feature/hold-p", pr: 1 },
    ]);
    const id = s.item("P").session_id!;
    queued(id, "after the land");
    q.update(db, s.stackId, { status: "landing" });
    expect(chatHold(id)).toMatch(/landed/);
    expect(claimNext(id)).toBeNull();
    q.update(db, s.stackId, { status: "landed" });
    expect(claimNext(id)?.text).toBe("after the land");
  });

  it("queues what's sent meanwhile instead of starting a turn", async () => {
    const id = chatSession("moving");
    await sendChat(id, { text: "sent during the move", queue: true });
    await sendChat(id, { text: "from another agent", from: "peer-1" });
    expect(listQueue(id).map((m) => m.text)).toEqual([
      "sent during the move",
      "from another agent",
    ]);
    expect(sendNowRefusal(id, listQueue(id)[0].id)).toMatch(/move/);
  });

  it("refuses to start a worker for a task that moved away", async () => {
    const id = chatSession("moved");
    await expect(sendChat(id, { text: "hi" })).rejects.toThrow(
      /moved to box; open it there/
    );
  });
});

describe("stopping a chat between turns", () => {
  const states = (...s: (string | null | Error)[]) => {
    live.states = s;
    vi.spyOn(runner, "chatStateNow").mockImplementation(async () => {
      const next =
        live.states.length > 1 ? live.states.shift()! : live.states[0];
      if (next instanceof Error) throw next;
      return next as never;
    });
    vi.spyOn(runner, "stopChat").mockImplementation((id) => {
      live.stopped.push(id);
    });
  };
  const sleep = vi.fn(async () => {});

  it("waits out a running turn, then closes the worker", async () => {
    states("running", "running", "idle");
    const onWait = vi.fn();
    const stop = await stopChatAtTurnEnd("s1", {
      waitMs: 60_000,
      sleep,
      onWait,
    });
    expect(stop).toEqual({ stopped: true });
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(live.stopped).toContain("s1");
  });

  it("gives up at the cap without interrupting the turn", async () => {
    states("running");
    const interrupt = vi.spyOn(runner, "interruptChat");
    const stop = await stopChatAtTurnEnd("s2", { waitMs: 2_000, sleep });
    expect(stop).toMatchObject({ stopped: false });
    expect(stop.stopped || stop.reason).toMatch(/still running after 2s/);
    expect(interrupt).not.toHaveBeenCalled();
    expect(live.stopped).not.toContain("s2");
  });

  it("refuses at once when it waits on an answer, or its worker won't answer", async () => {
    states("waiting");
    expect(
      await stopChatAtTurnEnd("s3", { waitMs: 60_000, sleep })
    ).toMatchObject({
      stopped: false,
      reason: expect.stringMatching(/answer/),
    });
    states(new Error("ECONNREFUSED"));
    expect(
      await stopChatAtTurnEnd("s3", { waitMs: 60_000, sleep })
    ).toMatchObject({
      stopped: false,
      reason: expect.stringMatching(/isn't answering/),
    });
    expect(live.stopped).not.toContain("s3");
  });

  it("has nothing to stop when no worker runs", async () => {
    states(null);
    expect(await stopChatAtTurnEnd("s4", { waitMs: 0, sleep })).toEqual({
      stopped: true,
    });
    expect(live.stopped).not.toContain("s4");
  });
});
