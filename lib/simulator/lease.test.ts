import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import {
  bootedCount,
  dropLease,
  getLease,
  IDLE_MS,
  maxBooted,
  planSweep,
  putLease,
  touchLease,
  type Lease,
} from "./lease";
import {
  baseName,
  deviceNameFor,
  instancePrefix,
  type SimDevice,
} from "./simctl";

beforeEach(() => db.prepare(`DELETE FROM simulator_leases`).run());

describe("leases", () => {
  it("keep their device when the state changes", () => {
    putLease("s1", { name: "n", udid: "U", state: "starting" }, 1);
    putLease("s1", { name: "n", state: "ready" }, 2);
    expect(getLease("s1")).toMatchObject({
      udid: "U",
      state: "ready",
      created_at: 1,
      last_used_at: 2,
    });
    touchLease("s1", 9);
    expect(getLease("s1")?.last_used_at).toBe(9);
    dropLease("s1");
    expect(getLease("s1")).toBeUndefined();
  });

  it("count only booted devices, not the asker's own", () => {
    putLease("a", { name: "a", state: "ready" });
    putLease("b", { name: "b", state: "starting" });
    putLease("c", { name: "c", state: "shutdown" });
    putLease("d", { name: "d", state: "failed" });
    expect(bootedCount()).toBe(2);
    expect(bootedCount("a")).toBe(1);
  });

  it("default to two booted at once", () => {
    expect(maxBooted()).toBe(2);
  });
});

describe("planSweep", () => {
  const NOW = 10_000_000;
  const lease = (id: string, over: Partial<Lease> = {}): Lease => ({
    session_id: id,
    udid: `U-${id}`,
    name: deviceNameFor(id.padEnd(8, "0")),
    state: "ready",
    error: null,
    created_at: 0,
    last_used_at: NOW,
    ...over,
  });
  const device = (l: Lease, state = "Booted"): SimDevice => ({
    udid: l.udid!,
    name: l.name,
    state,
    runtime: "rt",
  });
  const live = new Map([["live", { ended: false }]]);

  it("deletes the device of a session that ended or is gone", () => {
    const a = lease("gone");
    const plan = planSweep([a], [device(a)], live, NOW);
    expect(plan.remove).toEqual([{ device: device(a), sessionId: "gone" }]);
    const b = lease("done");
    expect(
      planSweep([b], [device(b)], new Map([["done", { ended: true }]]), NOW)
        .remove
    ).toHaveLength(1);
  });

  it("deletes a failed lease's device", () => {
    const a = lease("live", { state: "failed" });
    expect(planSweep([a], [device(a)], live, NOW).remove).toHaveLength(1);
  });

  it("shuts down an idle booted device but keeps the lease", () => {
    const a = lease("live", { last_used_at: NOW - IDLE_MS - 1 });
    const plan = planSweep([a], [device(a)], live, NOW);
    expect(plan.shutdown).toHaveLength(1);
    expect(plan.remove).toEqual([]);
  });

  it("leaves a recently used, an already shut down and a starting device", () => {
    const fresh = lease("live", { last_used_at: NOW - 1000 });
    expect(planSweep([fresh], [device(fresh)], live, NOW).shutdown).toEqual([]);
    const off = lease("live", { last_used_at: 0 });
    expect(
      planSweep([off], [device(off, "Shutdown")], live, NOW).shutdown
    ).toEqual([]);
    const starting = lease("live", { last_used_at: 0, state: "starting" });
    expect(
      planSweep([starting], [device(starting)], live, NOW).shutdown
    ).toEqual([]);
  });

  it("drops a lease whose device is gone, unless it is still being made", () => {
    const a = lease("live", { state: "ready" });
    expect(planSweep([a], [], live, NOW).dropLeases).toEqual(["live"]);
    const making = lease("live", { state: "creating" });
    const here = new Set(["live"]);
    const plan = planSweep([making], [], live, NOW, undefined, here);
    expect(plan.dropLeases).toEqual([]);
    expect(plan.interrupted).toEqual([]);
    const orphaned = lease("gone", { state: "creating" });
    expect(planSweep([orphaned], [], live, NOW).dropLeases).toEqual(["gone"]);
  });

  it("marks a bring-up a restart cut off as interrupted, shutting its device down", () => {
    for (const state of ["creating", "starting"] as const) {
      const a = lease("live", { state });
      const withDevice = planSweep([a], [device(a)], live, NOW);
      expect(withDevice.interrupted).toEqual([
        {
          sessionId: "live",
          name: a.name,
          device: { udid: a.udid, name: a.name },
        },
      ]);
      expect(withDevice.remove).toEqual([]);
      expect(withDevice.dropLeases).toEqual([]);
      expect(planSweep([a], [], live, NOW).interrupted[0].device).toBeNull();
    }
  });

  it("leaves a bring-up running in this process, and its fresh device, alone", () => {
    const a = lease("live", { state: "starting" });
    const here = new Set(["live"]);
    const plan = planSweep([a], [device(a)], live, NOW, undefined, here);
    expect(plan).toMatchObject({ interrupted: [], remove: [], shutdown: [] });
    // Its device is made before its lease row is recorded.
    const fresh: SimDevice = {
      ...device(a),
      name: deviceNameFor("new".padEnd(8, "0")),
    };
    expect(
      planSweep(
        [],
        [fresh],
        new Map(),
        NOW,
        undefined,
        new Set(["new".padEnd(8, "0")])
      ).remove
    ).toEqual([]);
  });

  it("deletes the device of an interrupted bring-up whose task ended", () => {
    const a = lease("done", { state: "starting" });
    const plan = planSweep(
      [a],
      [device(a)],
      new Map([["done", { ended: true }]]),
      NOW
    );
    expect(plan.remove).toHaveLength(1);
    expect(plan.interrupted).toEqual([]);
  });

  it("deletes this instance's unclaimed devices, never the base or others'", () => {
    const stray: SimDevice = {
      udid: "S",
      name: `${instancePrefix()}deadbeef`,
      state: "Booted",
      runtime: "rt",
    };
    const base = { ...stray, udid: "B", name: baseName() };
    const other = { ...stray, udid: "O", name: "aos-ffffff-deadbeef" };
    const project = { ...stray, udid: "P", name: "agentos-main-e97444" };
    const plan = planSweep([], [stray, base, other, project], new Map(), NOW);
    expect(plan.remove).toEqual([{ device: stray, sessionId: null }]);
  });
});
