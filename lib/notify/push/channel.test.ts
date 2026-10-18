import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import { tempDir } from "@/lib/test-temp";

const relaySend = vi.fn();
vi.mock("./relay", () => ({
  linked: () => true,
  NOT_LINKED: "this machine isn't linked to Connect",
  relaySend: (...a: unknown[]) => relaySend(...a),
}));
vi.mock("./presence", () => ({ atMac: async () => false }));

const { sendPhone, notifyFrom } = await import("../index");
const { sender } = await import("./index");
const { outboxRows, pairPhone, resetPush } = await import("./testing");

const dir = tempDir("aos-channel-");
const out = path.join(dir, "telegram.txt");
const delivered = () =>
  fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
const before = process.env.AGENTOS_NOTIFY_CMD;

beforeEach(() => {
  resetPush();
  db.prepare(`DELETE FROM notify_outbox`).run();
  fs.rmSync(out, { force: true });
  process.env.AGENTOS_NOTIFY_CMD = `cat >> '${out}'`;
  relaySend.mockReset();
  relaySend.mockImplementation(async (b: { devices: unknown[] }) => ({
    kind: "results",
    results: b.devices.map(() => ({ status: "sent" })),
  }));
});
afterEach(() => {
  if (before === undefined) delete process.env.AGENTOS_NOTIFY_CMD;
  else process.env.AGENTOS_NOTIFY_CMD = before;
});

describe("the channel switch in sendPhone", () => {
  it("without a registered phone it is Telegram, as before", async () => {
    expect(
      await sendPhone("load", "Load is red", { category: "system" })
    ).toEqual({ state: "sent" });
    expect(delivered()).toContain("Load is red");
    expect(relaySend).not.toHaveBeenCalled();
  });

  it("with a phone registered it goes by push and Telegram stays quiet", async () => {
    pairPhone();
    expect(
      await sendPhone("load", "Load is red", {
        category: "system",
        key: "system:load:1",
      })
    ).toEqual({ state: "pushed" });
    await sender().kick();
    expect(relaySend).toHaveBeenCalledTimes(1);
    expect(outboxRows()[0].state).toBe("sent");
    expect(delivered()).toBe("");
  });

  it("a message with no push category stays on Telegram even with a phone", async () => {
    pairPhone();
    await sendPhone("usage", "Nightly usage");
    expect(delivered()).toContain("Nightly usage");
    expect(relaySend).not.toHaveBeenCalled();
  });

  it("push failing for good falls back to Telegram once", async () => {
    pairPhone();
    relaySend.mockResolvedValue({ kind: "retry", reason: "busy" });
    await sendPhone("load", "Load is red", {
      category: "system",
      key: "system:load:1",
    });
    await sender().kick();
    // Two more tries, as the backoff comes due.
    for (let i = 0; i < 2; i++) {
      db.prepare(
        `UPDATE push_outbox SET next_attempt_at = 0 WHERE state = 'pending'`
      ).run();
      await sender().kick();
    }
    await vi.waitFor(() => expect(delivered()).toContain("Load is red"));
    expect(delivered().match(/Load is red/g)).toHaveLength(1);
    expect(relaySend).toHaveBeenCalledTimes(3);
  });

  it("push not set up: the first message falls back, the next goes straight to Telegram with no relay call", async () => {
    pairPhone();
    relaySend.mockResolvedValue({
      kind: "unavailable",
      reason: "push isn't set up on the Connect service yet",
    });
    await sendPhone("a", "first message", {
      category: "system",
      key: "system:a",
    });
    await sender().kick();
    await vi.waitFor(() => expect(delivered()).toContain("first message"));
    const out2 = await sendPhone("b", "second message", {
      category: "system",
      key: "system:b",
    });
    expect(out2).toEqual({ state: "sent" });
    expect(delivered()).toContain("second message");
    expect(relaySend).toHaveBeenCalledTimes(1);
  });

  it("a category the phone turned off sends nothing anywhere", async () => {
    pairPhone(["asks"]);
    expect(
      await sendPhone("load", "Load is red", {
        category: "system",
        key: "system:x",
      })
    ).toEqual({ state: "skipped" });
    expect(delivered()).toBe("");
  });

  it("aos notify from an agent is an agents push", async () => {
    pairPhone();
    expect(await notifyFrom(null, "morning report")).toEqual({
      state: "pushed",
    });
    await sender().kick();
    expect(outboxRows()[0]).toMatchObject({
      category: "agents",
      fallback_text: "morning report",
    });
  });
});
