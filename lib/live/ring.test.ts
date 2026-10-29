import { describe, expect, it } from "vitest";
import { RING_BYTES, RING_ITEMS, Ring, chunk } from "./ring";
import type { ItemFrame } from "./frames";

const note = (id: string, text = "x"): ItemFrame => ({
  id,
  kind: "note",
  text,
  at: 1,
});

describe("Ring", () => {
  it("keeps the last 200 items", () => {
    const r = new Ring();
    for (let i = 0; i < 250; i++) r.upsert(note(`n${i}`));
    expect(r.size).toBe(RING_ITEMS);
    expect(r.list()[0].id).toBe("n50");
  });

  it("stays under the byte cap", () => {
    const r = new Ring();
    for (let i = 0; i < 40; i++) r.upsert(note(`n${i}`, "y".repeat(20_000)));
    expect(r.byteSize).toBeLessThanOrEqual(RING_BYTES);
    expect(r.list().at(-1)?.id).toBe("n39");
  });

  it("replaces an item in place", () => {
    const r = new Ring();
    r.upsert(note("a", "one"));
    r.upsert(note("b"));
    r.upsert(note("a", "two"));
    expect(r.list().map((f) => f.id)).toEqual(["a", "b"]);
    expect((r.list()[0] as { text: string }).text).toBe("two");
  });
});

describe("chunk", () => {
  it("splits catch-up by size, in order, with nothing lost", () => {
    const frames = Array.from({ length: 30 }, (_, i) =>
      note(`n${i}`, "z".repeat(10_000))
    );
    const parts = chunk(frames);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat().map((f) => f.id)).toEqual(frames.map((f) => f.id));
    for (const p of parts)
      expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(60 * 1024);
  });
});
