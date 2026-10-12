import { describe, expect, it } from "vitest";
import {
  CTX_LIMIT,
  ctxOf,
  family,
  overLimit,
  weighted,
  type TokenRow,
} from "./weights";

const row = (over: Partial<TokenRow> = {}): TokenRow => ({
  model: "claude-opus-5-5",
  provider: "anthropic",
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_write_5m_tokens: 0,
  cache_write_1h_tokens: 0,
  output_tokens: 0,
  ...over,
});
const k = (n: number) => n * 1000;

describe("weighted", () => {
  it("prices each token type at its ratio, Opus input = 1", () => {
    expect(weighted(row({ input_tokens: k(10) }))).toBe(k(10));
    expect(weighted(row({ cache_write_5m_tokens: k(10) }))).toBe(k(10) * 1.25);
    expect(weighted(row({ cache_write_1h_tokens: k(10) }))).toBe(k(10) * 2);
    expect(weighted(row({ cache_read_tokens: k(10) }))).toBe(k(10) * 0.1);
    expect(weighted(row({ output_tokens: k(10) }))).toBe(k(10) * 5);
  });

  it("halves Sonnet but not its cache reads, and quarters Haiku", () => {
    const all = {
      input_tokens: k(4),
      output_tokens: k(2),
      cache_read_tokens: k(100),
    };
    const opus = weighted(row(all));
    expect(weighted(row({ ...all, model: "claude-sonnet-5-5" }))).toBe(
      0.5 * (k(4) + 5 * k(2)) + 0.1 * k(100)
    );
    expect(weighted(row({ ...all, model: "claude-haiku-4-5-20251001" }))).toBe(
      0.25 * (k(4) + 5 * k(2)) + 0.05 * k(100)
    );
    expect(opus).toBe(k(4) + 5 * k(2) + 0.1 * k(100));
  });

  it("weighs an unknown Claude id as Opus and other providers as nothing", () => {
    expect(family("claude-fable-5-1")).toBe("opus");
    expect(family(null)).toBe("opus");
    expect(weighted(row({ input_tokens: k(1), provider: "openai" }))).toBe(0);
  });
});

describe("context", () => {
  it("sums what the call sent, and 200k itself is not above", () => {
    const r = row({
      input_tokens: 5,
      cache_read_tokens: CTX_LIMIT - 15,
      cache_write_5m_tokens: 4,
      cache_write_1h_tokens: 6,
      output_tokens: 99_999,
    });
    expect(ctxOf(r)).toBe(CTX_LIMIT);
    expect(overLimit(ctxOf(r))).toBe(false);
    expect(overLimit(ctxOf(r) + 1)).toBe(true);
    expect(overLimit(null)).toBe(false);
  });
});
