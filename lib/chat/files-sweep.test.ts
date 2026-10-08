import { describe, expect, it, vi } from "vitest";

const { fallbackFileSuggestions, sweepFileIndexes, fileIndexCount, IDLE_MS } =
  await import("./files");

describe("file index sweep", () => {
  it("drops a folder's index once nobody has used it for a while", async () => {
    vi.useFakeTimers();
    try {
      await fallbackFileSuggestions("/tmp/no-such-folder-for-index", "a");
      expect(fileIndexCount()).toBe(1);
      sweepFileIndexes(Date.now() + IDLE_MS - 1000);
      expect(fileIndexCount()).toBe(1);
      sweepFileIndexes(Date.now() + IDLE_MS + 1000);
      expect(fileIndexCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
