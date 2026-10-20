import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, createBodyBudget } from "./rpc-intake";

describe("unverified body budget", () => {
  it("keeps each share well below the total", () => {
    expect(DEFAULT_BUDGET.perPeer * 4).toBeLessThanOrEqual(
      DEFAULT_BUDGET.total
    );
    expect(DEFAULT_BUDGET.perSource * 4).toBeLessThanOrEqual(
      DEFAULT_BUDGET.total
    );
  });

  it("caps a claimed sender, a source and the total separately", () => {
    const b = createBodyBudget({ total: 300, perPeer: 100, perSource: 150 });
    const one = b.open("1.1.1.1")!;
    expect(one.take("peer-a", 100)).toBe(true);
    // A's share is spent, whoever claims it from wherever.
    expect(one.take("peer-a", 1)).toBe(false);
    const two = b.open("2.2.2.2")!;
    expect(two.take("peer-a", 1)).toBe(false);
    // The same source can still claim another sender, up to its own share.
    expect(one.take("peer-b", 50)).toBe(true);
    expect(one.take("peer-c", 1)).toBe(false);
    // Other sources aren't held up by it, until the total runs out.
    expect(two.take("peer-b", 50)).toBe(true);
    expect(two.take("peer-d", 100)).toBe(true);
    expect(b.open("3.3.3.3")!.take("peer-e", 1)).toBe(false);
  });

  it("limits open requests per source and gives everything back on close", () => {
    const b = createBodyBudget({ requestsPerSource: 2, perPeer: 100 });
    const t1 = b.open("1.1.1.1")!;
    const t2 = b.open("1.1.1.1")!;
    expect(b.open("1.1.1.1")).toBeNull();
    expect(b.open("2.2.2.2")).not.toBeNull();
    expect(t1.take("peer-a", 100)).toBe(true);
    expect(t2.take("peer-a", 1)).toBe(false);
    t1.close();
    t1.close();
    expect(t1.take("peer-a", 1)).toBe(false);
    expect(t2.take("peer-a", 100)).toBe(true);
    expect(b.open("1.1.1.1")).not.toBeNull();
  });
});
