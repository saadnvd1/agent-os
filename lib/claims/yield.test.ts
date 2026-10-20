import { describe, expect, it } from "vitest";
import { TIE_WINDOW_MS, whoYields, winner } from "./yield";

const c = (id: string, startedAt: number, prUrl: string | null = null) => ({
  id,
  startedAt,
  prUrl,
});

describe("who yields", () => {
  it("lets an open PR beat none, whatever the start times", () => {
    const early = c("a", 0);
    const pr = c("b", 10 * TIE_WINDOW_MS, "https://example.test/pr/1");
    expect(winner(early, pr)).toBe(pr);
    expect(whoYields(early, pr)).toBe(early);
  });

  it("lets the earlier start win outside the tie window", () => {
    const early = c("z", 0);
    const late = c("a", TIE_WINDOW_MS + 1);
    expect(winner(early, late)).toBe(early);
  });

  it("calls starts inside the window a tie and takes the smaller id", () => {
    const x = c("b", 0);
    const y = c("a", TIE_WINDOW_MS - 1);
    expect(winner(x, y)).toBe(y);
  });

  it("gives both servers the same answer in either order", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 300; i++) {
      const a = c(
        `id${Math.floor(rnd() * 20)}`,
        Math.floor(rnd() * 8) * 60_000,
        rnd() < 0.3 ? "https://example.test/pr/2" : null
      );
      const b = c(
        `id${20 + Math.floor(rnd() * 20)}`,
        Math.floor(rnd() * 8) * 60_000,
        rnd() < 0.3 ? "https://example.test/pr/3" : null
      );
      expect(winner(a, b)).toBe(winner(b, a));
      expect(whoYields(a, b)).not.toBe(winner(a, b));
      expect(whoYields(a, b)).toBe(whoYields(b, a));
    }
  });
});
