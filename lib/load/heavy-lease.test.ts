import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/load/monitor", () => ({
  currentLevel: () => level.value,
  loadEnabled: () => true,
}));
const level = { value: "green" as "green" | "amber" | "red" | null };

const {
  releaseLease,
  requestLease,
  resetLeases,
  slotsNow,
  leaseCount,
  LEASE_STALE_MS,
} = await import("./heavy-lease");

const me = process.pid;

beforeEach(() => {
  resetLeases();
  level.value = "green";
});

describe("heavy slots for fork children", () => {
  it("gives 2 slots when calm and 1 otherwise", () => {
    expect(slotsNow()).toBe(2);
    level.value = "amber";
    expect(slotsNow()).toBe(1);
  });

  it("grants in the order asked and passes a slot on when one is released", () => {
    level.value = "amber";
    expect(requestLease("a", me).granted).toBe(true);
    const b = requestLease("b", me);
    expect(b).toEqual({ granted: false, ahead: 1 });
    const c = requestLease("c", me);
    expect(c.ahead).toBe(2);
    releaseLease("a", me);
    expect(requestLease("b", me).granted).toBe(true);
    expect(requestLease("c", me).granted).toBe(false);
  });

  it("still lets one run at a time while the machine is red", () => {
    level.value = "red";
    expect(slotsNow()).toBe(1);
    expect(requestLease("a", me).granted).toBe(true);
    expect(requestLease("b", me).granted).toBe(false);
  });

  it("queues sessions and callers outside any session alike", () => {
    level.value = "amber";
    expect(requestLease(null, me).granted).toBe(true);
    expect(requestLease("task", me)).toEqual({ granted: false, ahead: 1 });
    releaseLease(null, me);
    expect(requestLease("task", me).granted).toBe(true);
  });

  it("takes the slot counts from the environment, and ignores bad values", () => {
    vi.stubEnv("AGENTOS_HEAVY_SLOTS", "3");
    expect(slotsNow()).toBe(3);
    vi.stubEnv("AGENTOS_HEAVY_SLOTS", "0");
    vi.stubEnv("AGENTOS_HEAVY_SLOTS_CALM", "4");
    level.value = "amber";
    expect(slotsNow()).toBe(1);
    level.value = "green";
    expect(slotsNow()).toBe(4);
    vi.stubEnv("AGENTOS_HEAVY_SLOTS_CALM", "x");
    expect(slotsNow()).toBe(2);
    vi.unstubAllEnvs();
  });

  it("keeps a run going before a server restart: a holder the server doesn't know takes a slot", () => {
    level.value = "amber";
    expect(requestLease("a", me, Date.now(), true).granted).toBe(true);
    expect(requestLease("b", me).granted).toBe(false);
  });

  it("takes a slot back from a holder that stopped asking, or whose process is gone", () => {
    level.value = "amber";
    const t0 = 1_000_000;
    requestLease("a", me, t0);
    requestLease("b", me, t0 + 1);
    expect(requestLease("b", me, t0 + LEASE_STALE_MS + 5_000).granted).toBe(
      true
    );
    expect(leaseCount()).toBe(1);
    expect(
      requestLease("ghost", 2_147_483_000, t0 + LEASE_STALE_MS + 6_000).granted
    ).toBe(false);
    expect(requestLease("next", me, t0 + LEASE_STALE_MS + 7_000).granted).toBe(
      false
    );
    expect(leaseCount()).toBe(2);
  });
});
