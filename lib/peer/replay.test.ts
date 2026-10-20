import { describe, it, expect } from "vitest";
import { createReplayGuard } from "./replay";

const NOW = 1_800_000_000_000;

describe("replay guard", () => {
  it("refuses a nonce it has seen, per peer", () => {
    const g = createReplayGuard();
    expect(g.check("aaaa1111", "n1", NOW, NOW)).toBe("ok");
    expect(g.check("aaaa1111", "n1", NOW, NOW + 1000)).toBe("replay");
    // Another peer's nonces are its own.
    expect(g.check("bbbb2222", "n1", NOW, NOW)).toBe("ok");
  });

  it("refuses a timestamp more than 120 s off either way", () => {
    const g = createReplayGuard();
    expect(g.check("p", "a", NOW - 121_000, NOW)).toBe("stale");
    expect(g.check("p", "b", NOW + 121_000, NOW)).toBe("stale");
    expect(g.check("p", "c", NOW - 120_000, NOW)).toBe("ok");
    expect(g.check("p", "d", NOW + 120_000, NOW)).toBe("ok");
    expect(g.check("p", "e", Number.NaN, NOW)).toBe("stale");
  });

  it("still refuses a replay at the very end of the window", () => {
    const g = createReplayGuard();
    expect(g.check("p", "n", NOW, NOW)).toBe("ok");
    expect(g.check("p", "n", NOW, NOW + 120_000)).toBe("replay");
    // Past it, the timestamp refuses the copy on its own.
    expect(g.check("p", "n", NOW, NOW + 120_001)).toBe("stale");
  });

  it("evicts only nonces outside the window, and is busy rather than forget one inside it", () => {
    const g = createReplayGuard({ maxPerPeer: 3 });
    expect(g.check("p", "a", NOW, NOW)).toBe("ok");
    expect(g.check("p", "b", NOW + 1000, NOW + 1000)).toBe("ok");
    expect(g.check("p", "c", NOW + 2000, NOW + 2000)).toBe("ok");
    // Full of nonces still inside the window: no room, and none forgotten.
    expect(g.check("p", "d", NOW + 3000, NOW + 3000)).toBe("busy");
    expect(g.check("p", "a", NOW, NOW + 3000)).toBe("replay");
    // Once "a" is outside the window there's room again, and only it went.
    const later = NOW + 120_500;
    expect(g.check("p", "e", later, later)).toBe("ok");
    expect(g.check("p", "b", NOW + 1000, later)).toBe("replay");
    expect(g.check("p", "c", NOW + 2000, later)).toBe("replay");
  });

  it("refuses anything stamped before it was made, so a restart can't reopen the window", () => {
    const before = createReplayGuard({ startedAt: NOW - 60_000 });
    expect(before.check("p", "n", NOW - 30_000, NOW)).toBe("ok");
    // The server restarts: a fresh guard has forgotten "n".
    const after = createReplayGuard({ startedAt: NOW });
    expect(after.check("p", "n", NOW - 30_000, NOW)).toBe("stale");
    expect(after.check("p", "m", NOW, NOW)).toBe("ok");
  });
});
