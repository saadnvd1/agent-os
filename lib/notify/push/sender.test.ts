import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import { getDevicePush } from "@/lib/security/devices";
import { enqueue } from "./outbox";
import { PushSender, UNAVAILABLE_MS } from "./sender";
import type { RelayAnswer } from "./relay";
import type { PushRequestBody } from "@/lib/connect/control-api";
import { encodePush } from "./encode";
import { outboxRows, pairPhone, resetPush } from "./testing";

let now = 1_000_000_000_000;
const fallback = vi.fn(async (_source: string, _text: string) => {});
const relay = vi.fn(
  async (_body: PushRequestBody): Promise<RelayAnswer> => ({
    kind: "results",
    results: [],
  })
);

const sender = () =>
  new PushSender({ now: () => now, relay, fallback, log: () => {} });

function queue(
  deviceId: string,
  key = `review:t1:${now}`,
  text: string | null = "Ready"
) {
  const enc = encodePush({ category: "review", id: "t1", key });
  return enqueue({
    eventKey: key,
    deviceId,
    category: "review",
    level: enc.level,
    payload: enc.payload,
    collapseId: enc.collapseId,
    now,
    fallback: text ? { source: "push-test", text } : null,
  });
}

const sent = (n = 1): RelayAnswer => ({
  kind: "results",
  results: Array.from({ length: n }, () => ({ status: "sent" as const })),
});

beforeEach(() => {
  resetPush();
  now = 1_000_000_000_000;
  relay.mockReset();
  fallback.mockReset();
  fallback.mockResolvedValue(undefined);
});

describe("PushSender", () => {
  it("marks a row sending before the relay call, then sent, with the right request", async () => {
    const id = pairPhone();
    queue(id);
    relay.mockImplementation(async () => {
      expect(outboxRows()[0].state).toBe("sending");
      return sent();
    });
    await sender().kick();
    expect(outboxRows()[0].state).toBe("sent");
    const body = relay.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(body).toMatchObject({
      v: 1,
      push_type: "alert",
      priority: 10,
      level: "active",
      thread_id: "review",
      payload: { v: 1, c: "review", t: "AgentOS" },
    });
    expect(body.collapse_id).toMatch(/^[0-9a-f]{32}$/);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("queues an event once per device", () => {
    const id = pairPhone();
    expect(queue(id, "k1")).toBe(true);
    expect(queue(id, "k1")).toBe(false);
    expect(outboxRows()).toHaveLength(1);
  });

  it("a newer event with the same collapse id replaces a pending one", () => {
    const id = pairPhone();
    const enc = encodePush({
      category: "review",
      id: "t1",
      key: "a",
      collapse: "task:t1",
    });
    for (const key of ["a", "b"])
      enqueue({
        eventKey: key,
        deviceId: id,
        category: "review",
        level: "active",
        payload: enc.payload,
        collapseId: enc.collapseId,
        now,
      });
    expect(outboxRows().map((r) => r.state)).toEqual(["superseded", "pending"]);
  });

  it("retries a failure at 30s then 2min, then gives up and falls back once", async () => {
    const id = pairPhone();
    queue(id);
    relay.mockResolvedValue({ kind: "retry", reason: "apns busy" });
    const s = sender();
    await s.kick();
    let row = outboxRows()[0];
    expect([row.state, row.attempts, row.next_attempt_at]).toEqual([
      "pending",
      1,
      now + 30_000,
    ]);

    await s.kick(); // not due yet
    expect(relay).toHaveBeenCalledTimes(1);

    now += 30_000;
    await s.kick();
    row = outboxRows()[0];
    expect([row.state, row.attempts, row.next_attempt_at]).toEqual([
      "pending",
      2,
      now + 120_000,
    ]);

    now += 120_000;
    await s.kick();
    row = outboxRows()[0];
    expect([row.state, row.attempts]).toEqual(["failed", 3]);
    expect(getDevicePush(id)?.lastError).toBe("apns busy");
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith("push-test", "Ready");
  });

  it("honours a longer retry_after than the backoff", async () => {
    const id = pairPhone();
    queue(id);
    relay.mockResolvedValue({
      kind: "results",
      results: [{ status: "retry", retry_after: 300 }],
    });
    await sender().kick();
    expect(outboxRows()[0].next_attempt_at).toBe(now + 300_000);
  });

  it("prunes a token the relay reports dead, keeping the chosen categories", async () => {
    const id = pairPhone(["review", "asks"]);
    queue(id);
    relay.mockResolvedValue({
      kind: "results",
      results: [{ status: "gone", prune: true, reason: "Unregistered" }],
    });
    await sender().kick();
    expect(outboxRows()[0].state).toBe("gone");
    expect(getDevicePush(id)).toBeNull();
    const row = db
      .prepare(
        `SELECT push_token, push_categories, push_last_error FROM devices WHERE id = ?`
      )
      .get(id) as Record<string, string | null>;
    expect(row.push_token).toBeNull();
    expect(JSON.parse(row.push_categories!)).toEqual(["review", "asks"]);
    expect(row.push_last_error).toMatch(/Unregistered/);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("a rejected push fails without pruning and records why", async () => {
    const id = pairPhone();
    queue(id);
    relay.mockResolvedValue({
      kind: "results",
      results: [{ status: "rejected", reason: "PayloadTooLarge" }],
    });
    await sender().kick();
    expect(outboxRows()[0]).toMatchObject({
      state: "failed",
      error: "PayloadTooLarge",
    });
    expect(getDevicePush(id)?.lastError).toBe("PayloadTooLarge");
    expect(getDevicePush(id)).not.toBeNull();
  });

  it("push not configured: no retries, everything waiting falls back at once, and the relay is left alone", async () => {
    const a = pairPhone();
    const b = pairPhone();
    queue(a, "k1", "one");
    queue(b, "k2", "two");
    relay.mockResolvedValue({
      kind: "unavailable",
      reason: "push isn't set up on the Connect service yet",
    });
    const s = sender();
    await s.kick();
    expect(relay).toHaveBeenCalledTimes(1);
    expect(outboxRows().map((r) => r.state)).toEqual(["failed", "failed"]);
    expect(fallback.mock.calls.map((c) => c[1]).sort()).toEqual(["one", "two"]);
    expect(s.unavailable()).toMatch(/isn't set up/);
    expect(getDevicePush(a)?.lastError).toMatch(/isn't set up/);

    now += UNAVAILABLE_MS - 1;
    expect(s.unavailable()).not.toBeNull();
    now += 1;
    expect(s.unavailable()).toBeNull();
  });

  it("falls back only when no phone was reached", async () => {
    const a = pairPhone();
    const b = pairPhone();
    queue(a, "k1");
    queue(b, "k1");
    relay.mockResolvedValue({
      kind: "results",
      results: [{ status: "sent" }, { status: "rejected", reason: "x" }],
    });
    await sender().kick();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("sends at most 10 devices a call", async () => {
    for (let i = 0; i < 12; i++) queue(pairPhone(), "k1");
    relay.mockImplementation(async (b) => sent(b.devices.length));
    await sender().kick();
    expect(relay.mock.calls.map((c) => c[0].devices.length)).toEqual([10, 2]);
  });

  it("a restart sends what was mid-send again with the same collapse id", async () => {
    const id = pairPhone();
    queue(id);
    db.prepare(`UPDATE push_outbox SET state = 'sending', attempts = 1`).run();
    const collapse = outboxRows()[0].collapse_id;
    relay.mockResolvedValue(sent());
    const s = sender();
    s.resume();
    await s.kick();
    expect(outboxRows()[0].state).toBe("sent");
    expect(relay.mock.calls[0][0].collapse_id).toBe(collapse);
  });

  it("an event that waited over an hour is dropped, not sent late, and falls back", async () => {
    const id = pairPhone();
    queue(id);
    now += 3_600_001;
    await sender().kick();
    expect(relay).not.toHaveBeenCalled();
    expect(outboxRows()[0]).toMatchObject({
      state: "failed",
      error: "too old to send",
    });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("refuses a token that isn't hex rather than sending the relay a bad batch", async () => {
    const id = pairPhone();
    db.prepare(`UPDATE devices SET push_token = 'not-hex' WHERE id = ?`).run(
      id
    );
    queue(id);
    await sender().kick();
    expect(relay).not.toHaveBeenCalled();
    expect(outboxRows()[0].state).toBe("failed");
    expect(getDevicePush(id)?.lastError).toMatch(/isn't an APNs token/);
  });

  it("a relay call that throws never escapes kick()", async () => {
    const id = pairPhone();
    queue(id);
    relay.mockRejectedValue(new Error("boom"));
    await expect(sender().kick()).resolves.toBeUndefined();
  });
});
