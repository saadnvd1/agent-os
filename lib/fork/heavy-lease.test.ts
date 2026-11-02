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

  it("starts nothing new while the machine is red", () => {
    level.value = "red";
    expect(requestLease("a", me).granted).toBe(false);
    level.value = "green";
    expect(requestLease("a", me).granted).toBe(true);
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
