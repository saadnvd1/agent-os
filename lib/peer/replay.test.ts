import { describe, it, expect } from "vitest";
import { sqliteNonceStore } from "./nonce-store";
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

  it("remembers nonces across a restart through the store, even ahead of its clock", () => {
    const store = sqliteNonceStore();
    const now = Date.now();
    // Stamped 60 s ahead of this machine's clock (a fast peer, or a server
    // that booted with a slow clock).
    const ts = now + 60_000;
    const before = createReplayGuard({ store });
    expect(before.check("aaaa1111", "restart-n", ts, now)).toBe("ok");
    // The server restarts: a fresh guard, nothing in memory, the same DB.
    const after = createReplayGuard({ store: sqliteNonceStore() });
    expect(after.check("aaaa1111", "restart-n", ts, now + 5_000)).toBe(
      "replay"
    );
    expect(after.check("aaaa1111", "restart-m", ts, now + 5_000)).toBe("ok");
    // Another peer's same nonce is its own.
    expect(after.check("bbbb2222", "restart-n", ts, now + 5_000)).toBe("ok");
  });

  it("forgets a stored nonce only once its timestamp is stale", () => {
    const store = sqliteNonceStore();
    expect(store.claim("p", "x", NOW + 120_000, NOW)).toBe(true);
    expect(store.claim("p", "x", NOW + 120_000, NOW + 1)).toBe(false);
    store.prune(NOW + 120_001);
    expect(store.claim("p", "x", NOW + 240_001, NOW + 120_001)).toBe(true);
  });

  it("refuses as busy, never ok, when the store can't be written", () => {
    const g = createReplayGuard({
      store: {
        claim: () => {
          throw new Error("disk full");
        },
        prune: () => {},
      },
    });
    expect(g.check("p", "n", NOW, NOW)).toBe("busy");
  });
});
