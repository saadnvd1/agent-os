import { describe, expect, it, vi } from "vitest";
import { withinDeadline } from "./deadline";

describe("withinDeadline", () => {
  it("passes a result through", async () => {
    await expect(withinDeadline(Promise.resolve(1), "x", 50)).resolves.toBe(1);
  });

  it("ends a hung done with an error that names the row", async () => {
    vi.useFakeTimers();
    const hung = new Promise<never>(() => {});
    const result = expect(
      withinDeadline(hung, "Fix pair page", 1000)
    ).rejects.toThrow(/Done on Fix pair page is taking longer than 1s/);
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    vi.useRealTimers();
  });
});
