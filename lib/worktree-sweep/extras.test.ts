import { beforeEach, describe, expect, it, vi } from "vitest";
import { cachedRootSize, forgetRootSizes } from "./extras";

const HOUR = 3600_000;

describe("measuring a whole root", () => {
  beforeEach(forgetRootSizes);

  it("reads the disk once per six hours, and again when asked for fresh numbers", async () => {
    const size = vi.fn(async () => 42);
    expect(await cachedRootSize("/r", size, false, 0)).toBe(42);
    expect(await cachedRootSize("/r", size, false, 5 * HOUR)).toBe(42);
    expect(size).toHaveBeenCalledTimes(1);
    await cachedRootSize("/r", size, false, 7 * HOUR);
    expect(size).toHaveBeenCalledTimes(2);
    await cachedRootSize("/r", size, true, 7 * HOUR + 1);
    expect(size).toHaveBeenCalledTimes(3);
  });

  it("doesn't keep a 0, which is what a failed du reports", async () => {
    const size = vi.fn(async () => 0);
    await cachedRootSize("/r", size, false, 0);
    await cachedRootSize("/r", size, false, 1);
    expect(size).toHaveBeenCalledTimes(2);
  });

  it("keeps each root's own number", async () => {
    const size = async (dir: string) => dir.length;
    expect(await cachedRootSize("/a", size, false, 0)).toBe(2);
    expect(await cachedRootSize("/abc", size, false, 0)).toBe(4);
  });
});
