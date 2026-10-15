import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, insertSessionRow } from "../../db";
import { isGenericPayload } from "../copy";

const relaySend = vi.fn();
let isLinked = true;
vi.mock("./relay", () => ({
  linked: () => isLinked,
  NOT_LINKED: "this machine isn't linked to Connect",
  relaySend: (...a: unknown[]) => relaySend(...a),
}));
const atMac = vi.fn(async () => false);
vi.mock("./presence", () => ({ atMac: () => atMac() }));
const activeAway = vi.fn((): unknown => null);
vi.mock("../../away/state", async (orig) => ({
  ...(await orig<typeof import("../../away/state")>()),
  activeAway: () => activeAway(),
}));

const { pushEvent, sendTestPush, sender, takeFoldedPushes } =
  await import("./index");
const { outboxRows, pairPhone, resetPush } = await import("./testing");

const ok = () =>
  relaySend.mockImplementation(async (b: { devices: unknown[] }) => ({
    kind: "results",
    results: b.devices.map(() => ({ status: "sent" })),
  }));
const settle = () => sender().kick();

beforeEach(() => {
  resetPush();
  relaySend.mockReset();
  ok();
  isLinked = true;
  atMac.mockResolvedValue(false);
  activeAway.mockReturnValue(null);
});

describe("pushEvent", () => {
  it("does nothing without Connect or without a registered phone", async () => {
    expect(await pushEvent({ category: "asks", key: "ask:1" })).toBe(
      "unavailable"
    );
    pairPhone();
    isLinked = false;
    expect(await pushEvent({ category: "asks", key: "ask:1" })).toBe(
      "unavailable"
    );
    expect(outboxRows()).toHaveLength(0);
  });

  it("sends only to devices that have the category on (merged is off by default)", async () => {
    const on = pairPhone();
    const off = pairPhone(["asks"]);
    expect(
      await pushEvent({ category: "merged", id: "t1", key: "merged:t1" })
    ).toBe("muted");
    expect(outboxRows()).toHaveLength(0);
    expect(
      await pushEvent({ category: "review", id: "t1", key: "review:t1:a" })
    ).toBe("queued");
    await settle();
    expect(outboxRows().map((r) => r.device_id)).toEqual([on]);
    expect(off).not.toBe(on);
  });

  it("builds only generic, registry-made payloads with a hashed collapse id", async () => {
    pairPhone();
    await pushEvent({
      category: "ci",
      id: "task-1",
      key: "ci:task-1:abc",
      collapse: "task:task-1",
    });
    await settle();
    const [row] = outboxRows();
    expect(isGenericPayload(JSON.parse(row.payload))).toBe(true);
    expect(JSON.parse(row.payload)).toMatchObject({
      c: "ci",
      l: "/task/task-1",
      p: "active",
    });
    expect(row.collapse_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("holds back what he'd see at the Mac, but never an ask or an agent message", async () => {
    pairPhone(["review", "asks", "agents"]);
    atMac.mockResolvedValue(true);
    expect(await pushEvent({ category: "review", id: "t", key: "r1" })).toBe(
      "dropped"
    );
    expect(await pushEvent({ category: "asks", id: "w", key: "ask:1" })).toBe(
      "queued"
    );
    expect(await pushEvent({ category: "agents", id: "s", key: "a1" })).toBe(
      "queued"
    );
    await settle();
    expect(outboxRows().map((r) => r.category)).toEqual(["asks", "agents"]);
  });

  it("while Away is on, everything but asks folds into the digest", async () => {
    pairPhone(["review", "asks", "ci"]);
    activeAway.mockReturnValue({ id: 1 });
    expect(await pushEvent({ category: "review", id: "t", key: "r1" })).toBe(
      "folded"
    );
    expect(await pushEvent({ category: "ci", id: "t", key: "c1" })).toBe(
      "folded"
    );
    expect(await pushEvent({ category: "asks", id: "w", key: "ask:1" })).toBe(
      "queued"
    );
    await settle();
    expect(relaySend).toHaveBeenCalledTimes(1);
    expect(takeFoldedPushes()).toBe(2);
    expect(takeFoldedPushes()).toBe(0);
  });

  it("caps alerting pushes at 10 an hour per device, with one summary, never capping asks", async () => {
    const id = pairPhone(["review", "asks", "merged"]);
    for (let i = 0; i < 10; i++)
      expect(
        await pushEvent({ category: "review", id: "t", key: `r${i}` })
      ).toBe("queued");
    await settle();
    expect(await pushEvent({ category: "review", id: "t", key: "r10" })).toBe(
      "queued"
    );
    expect(await pushEvent({ category: "review", id: "t", key: "r11" })).toBe(
      "queued"
    );
    await settle();
    const rows = outboxRows();
    expect(rows.filter((r) => r.state === "capped")).toHaveLength(2);
    const summaries = rows.filter((r) => r.category === "digest");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      level: "passive",
      state: "sent",
      device_id: id,
    });
    expect(await pushEvent({ category: "asks", id: "w", key: "ask:9" })).toBe(
      "queued"
    );
    // A passive push isn't counted against the cap.
    expect(
      await pushEvent(
        { category: "merged", id: "t", key: "m1" },
        { bypass: false }
      )
    ).toBe("queued");
    await settle();
    expect(relaySend.mock.calls.length).toBe(13);
  });

  it("a bypass (the Settings test) ignores presence, Away, the cap and muted categories, while the same event unbypassed is still held", async () => {
    const id = pairPhone(["asks"]);
    atMac.mockResolvedValue(true);
    activeAway.mockReturnValue({ id: 1 });
    for (let i = 0; i < 12; i++)
      await pushEvent({ category: "system", key: `t${i}` }, { bypass: true });
    expect(
      outboxRows().filter((r) => r.device_id === id && r.state !== "capped")
    ).toHaveLength(12);
    expect(outboxRows().some((r) => r.state === "capped")).toBe(false);
    // Without it the same event is muted, or folds while Away.
    expect(await pushEvent({ category: "system", key: "x" })).toBe("muted");
    pairPhone(["system", "review"]);
    expect(await pushEvent({ category: "system", key: "y" })).toBe("folded");
    activeAway.mockReturnValue(null);
    expect(await pushEvent({ category: "review", id: "t", key: "z" })).toBe(
      "dropped"
    );
  });

  it("never pushes for a session mirrored from another machine", async () => {
    pairPhone();
    insertSessionRow(db, {
      id: "mirror-1",
      name: "m",
      tmux_name: "m1",
      working_directory: "/tmp",
      peer_mirror: 1,
    });
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id) VALUES ('remote-1', 'r', 'r1', '/tmp', 'box')`
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES ('own-1', 'o', 'o1', '/tmp')`
    ).run();
    for (const id of ["mirror-1", "remote-1"])
      expect(
        await pushEvent(
          { category: "review", id, key: `r:${id}` },
          { sessionId: id }
        )
      ).toBe("dropped");
    expect(
      await pushEvent(
        { category: "review", id: "own-1", key: "r:own" },
        { sessionId: "own-1" }
      )
    ).toBe("queued");
    db.prepare(
      `DELETE FROM sessions WHERE id IN ('mirror-1','remote-1','own-1')`
    ).run();
  });

  it("stops asking the relay for ten minutes once push isn't set up, then asks again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      pairPhone();
      relaySend.mockResolvedValue({
        kind: "unavailable",
        reason: "push isn't set up on the Connect service yet",
      });
      expect(await pushEvent({ category: "asks", id: "w", key: "ask:1" })).toBe(
        "queued"
      );
      await settle();
      expect(relaySend).toHaveBeenCalledTimes(1);
      expect(await pushEvent({ category: "asks", id: "w", key: "ask:2" })).toBe(
        "unavailable"
      );
      expect(relaySend).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 600_001);
      ok();
      expect(await pushEvent({ category: "asks", id: "w", key: "ask:3" })).toBe(
        "queued"
      );
      await settle();
      expect(relaySend).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sendTestPush", () => {
  it("sends now whatever the quiet rules say, and reports what came back", async () => {
    const id = pairPhone(["asks"]);
    atMac.mockResolvedValue(true);
    activeAway.mockReturnValue({ id: 1 });
    const { results, unavailable } = await sendTestPush();
    expect(results).toEqual([{ deviceId: id, status: "sent", error: null }]);
    expect(unavailable).toBeNull();
  });

  it("says why when push isn't set up, and tries again the next time", async () => {
    pairPhone();
    relaySend.mockResolvedValue({
      kind: "unavailable",
      reason: "push isn't set up on the Connect service yet",
    });
    const first = await sendTestPush();
    expect(first.results[0]).toMatchObject({ status: "failed" });
    expect(first.unavailable).toMatch(/isn't set up/);
    await sendTestPush();
    expect(relaySend).toHaveBeenCalledTimes(2);
  });

  it("a failed test is not retried", async () => {
    pairPhone();
    relaySend.mockResolvedValue({ kind: "retry", reason: "busy" });
    const { results } = await sendTestPush();
    expect(results[0]).toMatchObject({ status: "failed", error: "busy" });
    expect(outboxRows()[0].state).toBe("failed");
  });

  it("without Connect it says so", async () => {
    pairPhone();
    isLinked = false;
    expect((await sendTestPush()).unavailable).toMatch(/isn't linked/);
  });
});
