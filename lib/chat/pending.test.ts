import { describe, expect, it } from "vitest";
import {
  ACCEPTED_TIMEOUT_MS,
  MAX_SENDS,
  SEND_TIMEOUT_MS,
  clientId,
  compactsFirst,
  overSends,
  pendingReducer,
  toResend,
  type PendingAction,
  type PendingSend,
} from "./pending";
import { isClientId } from "./client-send";

const run = (actions: PendingAction[], from: PendingSend[] = []) =>
  actions.reduce(pendingReducer, from);
const add = (id: string, now = 0): PendingAction => ({
  type: "add",
  send: { id, text: `text ${id}` },
  now,
});

describe("pending sends", () => {
  it("mints ids the server keeps", () => {
    const a = clientId();
    expect(isClientId(a)).toBe(true);
    expect(clientId()).not.toBe(a);
  });

  it("goes from sending to accepted, and leaves once it's in the chat", () => {
    let s = run([add("a"), add("b")]);
    expect(s.map((p) => p.status)).toEqual(["sending", "sending"]);
    s = run([{ type: "accepted", id: "a", now: 5 }], s);
    expect(s[0]).toMatchObject({ status: "accepted", at: 5 });
    s = run([{ type: "resolved", ids: ["a", "other"] }], s);
    expect(s.map((p) => p.id)).toEqual(["b"]);
  });

  it("leaves when the server queued it behind a running turn", () => {
    const s = run([add("a"), { type: "resolved", ids: ["a"] }]);
    expect(s).toEqual([]);
  });

  it("a failed send that arrives after all leaves too", () => {
    const s = run([
      add("a"),
      { type: "failed", id: "a", error: "x" },
      { type: "resolved", ids: ["a"] },
    ]);
    expect(s).toEqual([]);
  });

  it("keeps the same state object when nothing changes", () => {
    const s = run([add("a")]);
    expect(pendingReducer(s, { type: "resolved", ids: ["z"] })).toBe(s);
    expect(pendingReducer(s, { type: "tick", now: 1 })).toBe(s);
    expect(pendingReducer(s, add("a"))).toBe(s);
  });

  it("fails with no answer in time, and later if never shown", () => {
    let s = run([add("a"), add("b"), { type: "accepted", id: "b", now: 0 }]);
    s = pendingReducer(s, { type: "tick", now: SEND_TIMEOUT_MS });
    expect(s[0]).toMatchObject({
      status: "failed",
      error: "no answer from AgentOS",
    });
    expect(s[1].status).toBe("accepted");
    s = pendingReducer(s, { type: "tick", now: ACCEPTED_TIMEOUT_MS });
    expect(s[1]).toMatchObject({ status: "failed" });
  });

  it("is sent again on a new socket, up to a limit, then fails", () => {
    let s = run([add("a")]);
    expect(toResend(s).map((p) => p.id)).toEqual(["a"]);
    for (let i = 1; i < MAX_SENDS; i++)
      s = pendingReducer(s, { type: "resent", id: "a", now: i });
    expect(toResend(s)).toEqual([]);
    expect(overSends(s).map((p) => p.id)).toEqual(["a"]);
  });

  it("Retry sends a failed one again, and Edit drops it", () => {
    let s = run([add("a"), { type: "failed", id: "a", error: "x" }]);
    expect(toResend(s)).toEqual([]);
    s = pendingReducer(s, { type: "resent", id: "a", now: 9 });
    expect(s[0]).toMatchObject({ status: "sending", error: undefined, at: 9 });
    expect(pendingReducer(s, { type: "drop", id: "a" })).toEqual([]);
  });
});

describe("compactsFirst", () => {
  const send = { status: "accepted", compact: true } as const;
  it("holds from accepted, before the first compacting event", () => {
    expect(compactsFirst(send, { state: "idle", compacting: null })).toBe(true);
  });
  it("holds while compacting", () => {
    expect(
      compactsFirst(send, { state: "running", compacting: { since: 1 } })
    ).toBe(true);
  });
  it("ends once compaction is done or was skipped", () => {
    expect(compactsFirst(send, { state: "running", compacting: null })).toBe(
      false
    );
  });
  it("is not for normal or unaccepted sends", () => {
    const chat = { state: "idle", compacting: null } as const;
    expect(compactsFirst({ status: "accepted" }, chat)).toBe(false);
    expect(compactsFirst({ ...send, status: "sending" }, chat)).toBe(false);
  });
});
