import { describe, expect, it } from "vitest";
import type { ChatContext } from "./events";
import {
  cacheTtlMs,
  compactedLine,
  composerCompacts,
  staleLabel,
  staleness,
} from "./stale";

const MIN = 60_000;
const NOW = 1_800_000_000_000;
const ctx = (over: Partial<ChatContext> = {}): ChatContext => ({
  usedTokens: 412_000,
  maxTokens: 1_000_000,
  percentage: 41,
  categories: [],
  at: NOW - 47 * MIN,
  cacheTtlMs: 5 * MIN,
  ...over,
});
const idle = { state: "idle" as const, thresholdTokens: 150_000, now: NOW };

describe("cacheTtlMs", () => {
  it("reads the lifetime a turn wrote its cache with", () => {
    expect(
      cacheTtlMs({
        ephemeral_1h_input_tokens: 4229,
        ephemeral_5m_input_tokens: 0,
      })
    ).toBe(60 * MIN);
    expect(
      cacheTtlMs({
        ephemeral_1h_input_tokens: 0,
        ephemeral_5m_input_tokens: 812,
      })
    ).toBe(5 * MIN);
  });

  it("says nothing for a turn that only read the cache, or no usage", () => {
    expect(
      cacheTtlMs({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 })
    ).toBeUndefined();
    expect(cacheTtlMs(null)).toBeUndefined();
    expect(cacheTtlMs(undefined)).toBeUndefined();
  });
});

describe("staleness", () => {
  it("is stale only once the cache it used has expired, for either lifetime", () => {
    for (const ttl of [5 * MIN, 60 * MIN]) {
      const at = (idleMs: number) => ctx({ at: NOW - idleMs, cacheTtlMs: ttl });
      expect(staleness(at(ttl - 1), idle)).toBeNull();
      expect(staleness(at(ttl), idle)).toBeNull();
      expect(staleness(at(ttl + 1), idle)).toEqual({
        idleMs: ttl + 1,
        tokens: 412_000,
      });
    }
  });

  it("needs the context above the threshold, and 0 is off", () => {
    expect(staleness(ctx({ usedTokens: 150_000 }), idle)).toBeNull();
    expect(staleness(ctx({ usedTokens: 150_001 }), idle)).not.toBeNull();
    expect(staleness(ctx(), { ...idle, thresholdTokens: 0 })).toBeNull();
  });

  it("refuses mid-turn: running or waiting on an approval", () => {
    expect(staleness(ctx(), { ...idle, state: "running" })).toBeNull();
    expect(staleness(ctx(), { ...idle, state: "waiting" })).toBeNull();
    expect(staleness(ctx(), { ...idle, state: "error" })).not.toBeNull();
  });

  it("is never stale without a measure, or a cache lifetime the agent said", () => {
    expect(staleness(null, idle)).toBeNull();
    expect(staleness(ctx({ cacheTtlMs: undefined }), idle)).toBeNull();
  });

  it("reads as the composer's chip", () => {
    expect(staleLabel(staleness(ctx(), idle)!)).toBe("Idle 47m · 412k context");
    expect(staleLabel({ idleMs: 5 * 60 * MIN, tokens: 1_200_000 })).toBe(
      "Idle 5h · 1.2M context"
    );
  });
});

describe("composerCompacts", () => {
  it("compacts a stale chat unless the reader chose to send as is", () => {
    const opts = {
      state: "idle" as const,
      thresholdTokens: 150_000,
      asIs: false,
    };
    const stale = ctx({ at: Date.now() - 47 * MIN });
    expect(composerCompacts("continue", stale, opts)).toBe(true);
    expect(composerCompacts("continue", stale, { ...opts, asIs: true })).toBe(
      false
    );
    expect(composerCompacts("continue", ctx({ at: Date.now() }), opts)).toBe(
      false
    );
  });

  it("leaves a slash command as typed", () => {
    const stale = ctx({ at: Date.now() - 47 * MIN });
    expect(
      composerCompacts("/compact", stale, {
        state: "idle",
        thresholdTokens: 150_000,
        asIs: false,
      })
    ).toBe(false);
  });
});

describe("compactedLine", () => {
  const base = { id: "c", kind: "compacted" as const, createdAt: 1 };
  it("says it ran for a stale chat, with before and after", () => {
    expect(
      compactedLine({
        ...base,
        idleMs: 47 * MIN,
        before: 412_000,
        after: 38_000,
      })
    ).toBe("Compacted before sending · idle 47m · 412k → 38k tokens");
    expect(compactedLine({ ...base, idleMs: 47 * MIN, before: 412_000 })).toBe(
      "Compacted before sending · idle 47m · 412k → … tokens"
    );
  });

  it("keeps the plain lines for other compactions", () => {
    expect(compactedLine({ ...base, trigger: "auto" })).toBe(
      "Context compacted automatically"
    );
    expect(
      compactedLine({
        ...base,
        trigger: "manual",
        before: 90_000,
        after: 12_000,
      })
    ).toBe("Context compacted · 90k → 12k tokens");
  });
});
