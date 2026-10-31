import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryWriter, navStateOf, type HistoryLike } from "./history-writer";
import type { Position } from "./position";

// A browser's history, enough of it, counting the writes it is given.
function fakeHistory() {
  const entries: { state: unknown; url: string }[] = [
    { state: { __NA: true }, url: "/" },
  ];
  let at = 0;
  const calls = { push: 0, replace: 0 };
  const h: HistoryLike = {
    get state() {
      return entries[at].state;
    },
    pushState(state, _t, url) {
      calls.push++;
      entries.splice(at + 1, Infinity, { state, url: url ?? entries[at].url });
      at++;
    },
    replaceState(state, _t, url) {
      calls.replace++;
      entries[at] = { state, url: url ?? entries[at].url };
    },
  };
  return {
    h,
    entries,
    calls,
    back: () => at--,
    forward: () => at++,
    get at() {
      return at;
    },
  };
}

const pos = (block: string, offsetPx = 0): Position => ({
  block,
  offsetPx,
  atEnd: false,
});

describe("HistoryWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the position of the entry it leaves, so back lands where the reader was", () => {
    const f = fakeHistory();
    const w = new HistoryWriter(f.h);
    w.replace("/s/a", "a");
    w.setPosition("a", pos("m7", -12));
    w.push("/s/b", "b");
    expect(navStateOf(f.entries[0].state)?.pos).toEqual(pos("m7", -12));
    f.back();
    expect(navStateOf(f.h.state)).toMatchObject({
      sessionId: "a",
      pos: pos("m7", -12),
    });
    f.forward();
    expect(navStateOf(f.h.state)).toMatchObject({ sessionId: "b", index: 1 });
  });

  it("keeps the state the framework put there", () => {
    const f = fakeHistory();
    const w = new HistoryWriter(f.h);
    w.replace("/s/a", "a");
    w.setPosition("a", pos("m1"));
    w.flush();
    expect((f.entries[0].state as { __NA: boolean }).__NA).toBe(true);
  });

  it("keeps the state through a rename", () => {
    const f = fakeHistory();
    const w = new HistoryWriter(f.h);
    w.replace("/s/a", "a");
    w.setPosition("a", pos("m1"));
    w.flush();
    w.replace("/s/new-name-a", "a");
    expect(navStateOf(f.h.state)).toMatchObject({
      sessionId: "a",
      pos: pos("m1"),
    });
  });

  it("writes a scroll position at most once every two seconds", () => {
    const f = fakeHistory();
    const w = new HistoryWriter(f.h);
    w.replace("/s/a", "a");
    f.calls.replace = 0;
    for (let i = 0; i < 100; i++) {
      w.setPosition("a", pos("m" + i));
      vi.advanceTimersByTime(100);
    }
    // 10 seconds of scrolling.
    expect(f.calls.replace).toBeLessThanOrEqual(6);
    expect(f.calls.replace).toBeGreaterThan(0);
    expect(f.calls.push).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(navStateOf(f.h.state)?.pos?.block).toBe("m99");
  });

  it("drops a position that belongs to another chat", () => {
    const f = fakeHistory();
    const w = new HistoryWriter(f.h);
    w.replace("/s/a", "a");
    w.setPosition("b", pos("x"));
    w.flush();
    expect(navStateOf(f.h.state)?.pos).toBeUndefined();
  });

  it("stops writing positions in a burst and never stops a push", () => {
    const f = fakeHistory();
    const w = new HistoryWriter(f.h);
    w.replace("/s/a", "a");
    f.calls.replace = 0;
    // One write every 2 seconds for a minute would be 15; force far more by
    // moving the clock the way a stuck timer would.
    for (let i = 0; i < 80; i++) {
      vi.setSystemTime(1_000_000 + i * 100);
      w.setPosition("a", pos("m" + i));
      w.flush();
    }
    expect(f.calls.replace).toBeLessThanOrEqual(50);
    w.push("/s/b", "b");
    expect(f.calls.push).toBe(1);
  });

  it("indexes each push one past the entry it was made from", () => {
    const f = fakeHistory();
    const w = new HistoryWriter(f.h);
    w.replace("/s/a", "a");
    expect(w.push("/s/b", "b").index).toBe(1);
    expect(w.push("/s/c", "c").index).toBe(2);
    f.back();
    f.back();
    expect(w.push("/s/d", "d").index).toBe(1);
  });
});
