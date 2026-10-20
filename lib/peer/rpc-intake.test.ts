import { describe, expect, it } from "vitest";
import { MAX_REQUEST_ENVELOPE } from "./envelope";
import { DEFAULT_BUDGET, createBodyBudget } from "./rpc-intake";

describe("envelope byte budget", () => {
  it("keeps each share well below its total, and unproven bytes small", () => {
    expect(DEFAULT_BUDGET.perPeer * 4).toBeLessThanOrEqual(
      DEFAULT_BUDGET.total
    );
    expect(DEFAULT_BUDGET.perSource * 4).toBeLessThanOrEqual(
      DEFAULT_BUDGET.unverifiedTotal
    );
    // A handful of sources can't hold anything near a whole envelope.
    expect(DEFAULT_BUDGET.unverifiedTotal * 16).toBeLessThanOrEqual(
      MAX_REQUEST_ENVELOPE
    );
  });

  it("charges unproven bytes to the source only, never a sender", () => {
    const b = createBodyBudget({
      total: 300,
      perPeer: 100,
      unverifiedTotal: 50,
      perSource: 20,
    });
    const forger = b.open("1.1.1.1")!;
    expect(forger.take(20)).toBe(true);
    expect(forger.take(1)).toBe(false);
    // A's whole share is still there for A.
    const real = b.open("2.2.2.2")!;
    expect(real.take(10)).toBe(true);
    expect(real.prove("peer-a")).toBe(true);
    expect(real.take(90)).toBe(true);
    expect(real.take(1)).toBe(false);
    // Proving moved A's first bytes off the source's share.
    expect(b.open("2.2.2.2")!.take(20)).toBe(true);
  });

  it("keeps strangers' bytes out of what proven senders get", () => {
    const b = createBodyBudget({
      total: 100,
      perPeer: 100,
      unverifiedTotal: 30,
      perSource: 20,
    });
    expect(b.open("1.1.1.1")!.take(20)).toBe(true);
    expect(b.open("2.2.2.2")!.take(10)).toBe(true);
    // The unproven pool is spent, for everyone not yet proven...
    expect(b.open("3.3.3.3")!.take(1)).toBe(false);
    // ...but not what a proven sender may hold.
    const real = b.open("4.4.4.4")!;
    expect(real.prove("peer-a")).toBe(true);
    expect(real.take(100)).toBe(true);
  });

  it("refuses to prove a request whose bytes exceed the sender's share", () => {
    const b = createBodyBudget({ perPeer: 10, perSource: 50 });
    const t = b.open("1.1.1.1")!;
    expect(t.take(11)).toBe(true);
    expect(t.prove("peer-a")).toBe(false);
  });

  it("limits open requests per source and gives everything back on close", () => {
    const b = createBodyBudget({ requestsPerSource: 2, perPeer: 100 });
    const t1 = b.open("1.1.1.1")!;
    const t2 = b.open("1.1.1.1")!;
    expect(b.open("1.1.1.1")).toBeNull();
    expect(b.open("2.2.2.2")).not.toBeNull();
    expect(t1.prove("peer-a") && t1.take(100)).toBe(true);
    expect(t2.prove("peer-a") && t2.take(1)).toBe(false);
    t1.close();
    t1.close();
    expect(t1.take(1)).toBe(false);
    expect(t2.take(100)).toBe(true);
    expect(b.open("1.1.1.1")).not.toBeNull();
  });
});
