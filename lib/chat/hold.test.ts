import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({
  states: [] as (string | null | Error)[],
  stopped: [] as string[],
}));
vi.mock("./worker/client", async (orig) => ({
  ...(await orig<typeof import("./worker/client")>()),
  waitForExit: vi.fn(async () => {}),
}));

import {
  db,
  stackQueries as q,
  insertSessionRow,
  updateSessionRow,
} from "../db";
import { seedStack } from "../stacks/testing";
import { chatHold, collectWhileMoving } from "./hold";
import { claimNext, enqueue, listQueue } from "./queued";
import { sendChat, sendChatConfirmed, sendNowRefusal } from "./runner";
import { registry, type Live } from "./registry";
import { stopChatAtTurnEnd } from "./stop";
import * as runner from "./runner";
import { waitForExit } from "./worker/client";
import { tempDir } from "@/lib/test-temp";

function chatSession(status = "running"): string {
  const id = randomUUID();
  insertSessionRow(db, {
    id: id,
    name: "chat",
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    task_status: status,
    view: "chat",
    moved_to: status === "moved" ? "box" : null,
  });
  return id;
}

const queued = (id: string, text: string) =>
  enqueue(id, { id: `user-${randomUUID()}`, text });

describe("a paused chat", () => {
  it("keeps its queue while pausing or paused, and lets it go once resuming", () => {
    const id = chatSession("running");
    queued(id, "from CI");
    for (const state of ["pausing", "paused"]) {
      updateSessionRow(db, id, { pause_state: state });
      expect(chatHold(id)).toMatch(/resume/);
      expect(claimNext(id)).toBeNull();
      expect(listQueue(id)).toHaveLength(1);
    }
    updateSessionRow(db, id, { pause_state: "resuming" });
    expect(chatHold(id)).toBeNull();
    expect(claimNext(id)?.text).toBe("from CI");
  });
});

describe("a held chat", () => {
  it("keeps its queue while its task is moving, and lets it go after", () => {
    const id = chatSession("moving");
    queued(id, "wait for me");
    const packed = collectWhileMoving(id);
    expect(chatHold(id)).toMatch(/move/);
    // The worker's own drain, at a turn's end, takes nothing.
    expect(claimNext(id)).toBeNull();
    packed();
    updateSessionRow(db, id, { task_status: "running" });
    expect(chatHold(id)).toBeNull();
    expect(claimNext(id)?.text).toBe("wait for me");
  });

  it("keeps its queue while its stack is landing", () => {
    const s = seedStack(tempDir("hold-"), [
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
    const packed = collectWhileMoving(id);
    await sendChat(id, { text: "sent during the move", queue: true });
    await sendChat(id, { text: "from another agent", from: "peer-1" });
    expect(listQueue(id).map((m) => m.text)).toEqual([
      "sent during the move",
      "from another agent",
    ]);
    expect(sendNowRefusal(id, listQueue(id)[0].id)).toMatch(/move/);
    packed();
  });

  it("refuses, rather than strand, what's sent once the move packed the queue", async () => {
    const id = chatSession("moving");
    updateSessionRow(db, id, { moved_to: "box" });
    await expect(sendChat(id, { text: "too late" })).rejects.toThrow(
      "It's moving to box; send it there once it arrives"
    );
    expect(listQueue(id)).toEqual([]);
  });

  it("queues a send whose worker was still starting when the move began", async () => {
    const id = chatSession("running");
    const command = vi.fn();
    let started!: (live: Live) => void;
    registry.connecting.set(id, new Promise<Live>((r) => (started = r)));
    const send = sendChat(id, { text: "raced the move", queue: true });
    const confirmed = sendChatConfirmed(id, { text: "raced too" });
    // The move starts while the worker spins up.
    updateSessionRow(db, id, { task_status: "moving" });
    const packed = collectWhileMoving(id);
    started({ worker: { command }, state: "idle" } as unknown as Live);
    await send;
    expect(await confirmed).toBe("queued");
    expect(command).not.toHaveBeenCalled();
    expect(listQueue(id).map((m) => m.text)).toEqual([
      "raced the move",
      "raced too",
    ]);
    packed();
    registry.connecting.delete(id);
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
    // The worker has gone before the move packs the chat.
    expect(waitForExit).toHaveBeenCalledWith("s1");
  });

  it("gives up at the cap without interrupting the turn", async () => {
    states("running");
    const stop = await stopChatAtTurnEnd("s2", { waitMs: 2_000, sleep });
    expect(stop).toMatchObject({ stopped: false });
    expect(stop.stopped || stop.reason).toMatch(/still running after 2s/);
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

  it("waits for a worker still starting, then stops it", async () => {
    states("idle");
    let started!: () => void;
    registry.connecting.set(
      "s5",
      new Promise<Live>((r) => (started = () => r({} as Live)))
    );
    const stop = stopChatAtTurnEnd("s5", { waitMs: 60_000, sleep });
    await new Promise((r) => setTimeout(r, 0));
    expect(runner.chatStateNow).not.toHaveBeenCalledWith("s5");
    started();
    expect(await stop).toEqual({ stopped: true });
    expect(live.stopped).toContain("s5");
    expect(waitForExit).toHaveBeenCalledWith("s5");
    registry.connecting.delete("s5");
  });

  it("has nothing to stop when no worker runs", async () => {
    states(null);
    expect(await stopChatAtTurnEnd("s4", { waitMs: 0, sleep })).toEqual({
      stopped: true,
    });
    expect(live.stopped).not.toContain("s4");
    expect(waitForExit).not.toHaveBeenCalledWith("s4");
  });
});
