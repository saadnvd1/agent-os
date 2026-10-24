import { describe, expect, it } from "vitest";
import {
  MAX_RETRIES,
  TurnRetry,
  backoffMs,
  classifyProviderError,
  continuePrompt,
  retryNotice,
} from "./transient-retry";

const HEADERS = "Provider response headers timed out after 300000ms";

describe("classifyProviderError", () => {
  it.each([
    [HEADERS, "timeout"],
    ["Request timed out.", "timeout"],
    ["UND_ERR_HEADERS_TIMEOUT", "timeout"],
    ["fetch failed", "transient"],
    ["read ECONNRESET", "transient"],
    ["503 Service Unavailable", "transient"],
    ["429 Too Many Requests", "transient"],
    ["socket hang up", "transient"],
  ])("%s is %s", (message, kind) =>
    expect(classifyProviderError(message)).toBe(kind)
  );

  it.each([
    "401 Unauthorized: invalid api key",
    "This model's maximum context length is 32768 tokens",
    "The operation was aborted",
    "Invalid request: missing field",
    "",
  ])("never retries %s", (message) =>
    expect(classifyProviderError(message)).toBeUndefined()
  );
});

describe("backoff", () => {
  it("doubles from two seconds", () => {
    expect([1, 2, 3].map((n) => backoffMs(n, false))).toEqual([
      2000, 4000, 8000,
    ]);
  });

  it("stays within a fifth either way with jitter", () => {
    for (let i = 0; i < 50; i++) {
      const ms = backoffMs(2);
      expect(ms).toBeGreaterThanOrEqual(3200);
      expect(ms).toBeLessThanOrEqual(4800);
    }
  });
});

describe("TurnRetry", () => {
  const retry = () => new TurnRetry(false);

  it("retries a timeout three times and then stops", () => {
    const r = retry();
    const seen = Array.from({ length: MAX_RETRIES + 2 }, () =>
      r.next({ error: HEADERS })
    );
    expect(seen.map((d) => d.retry)).toEqual([true, true, true, false, false]);
    expect(seen.slice(0, 3).map((d) => d.retry && d.delayMs)).toEqual([
      2000, 4000, 8000,
    ]);
    expect(seen[3]).toMatchObject({ retry: false, attempts: 3 });
    expect(r.tried).toBe(3);
  });

  it("leaves other errors and an agent's own retry alone", () => {
    expect(retry().next({ error: "401 Unauthorized" }).retry).toBe(false);
    expect(retry().next({ error: HEADERS, harnessRetried: true }).retry).toBe(
      false
    );
  });

  it("compacts only before the last try, and only a heavy context", () => {
    const heavy = retry();
    const flags = [1, 2, 3].map(
      (_) =>
        (
          heavy.next({ error: HEADERS, contextHeavy: true }) as never as {
            compactFirst: boolean;
          }
        ).compactFirst
    );
    expect(flags).toEqual([false, false, true]);
    const light = retry();
    for (let i = 0; i < 3; i++)
      expect(
        (light.next({ error: HEADERS }) as { compactFirst: boolean })
          .compactFirst
      ).toBe(false);
  });

  it("starts over only when told to", () => {
    const r = retry();
    for (let i = 0; i < 3; i++) r.next({ error: HEADERS });
    expect(r.next({ error: HEADERS }).retry).toBe(false);
    r.reset();
    expect(r.next({ error: HEADERS }).retry).toBe(true);
  });
});

describe("messages", () => {
  it("tells the model to continue and not redo", () => {
    expect(continuePrompt(HEADERS)).toContain(HEADERS);
    expect(continuePrompt(HEADERS)).toMatch(/don't redo/);
  });

  it("says how long and which try", () => {
    const r = new TurnRetry(false).next({ error: HEADERS });
    expect(r.retry && retryNotice(r, HEADERS)).toMatch(/in 2s \(1 of 3\)/);
  });
});
