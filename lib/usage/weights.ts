/**
 * Weighted tokens: the API's price ratios by token type and model family, as
 * a proxy for how much of the plan's limits a call uses. Opus input = 1.
 * An estimate, not what the plan charges.
 */

import { ANTHROPIC } from "../models/roles";

export type Family = "opus" | "sonnet" | "haiku";

export interface TokenRow {
  model: string | null;
  provider?: string | null;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  output_tokens: number;
}

// Unknown Claude ids weigh as Opus.
export const family = (model: string | null | undefined): Family => {
  const m = (model ?? "").toLowerCase();
  return m.includes("sonnet")
    ? "sonnet"
    : m.includes("haiku")
      ? "haiku"
      : "opus";
};

const MULT: Record<Family, number> = { opus: 1, sonnet: 0.5, haiku: 0.25 };
const READ: Record<Family, number> = { opus: 0.1, sonnet: 0.1, haiku: 0.05 };

export const WEIGHTS = {
  input: 1,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
  output: 5,
} as const;

export function weighted(r: TokenRow): number {
  if (r.provider && r.provider !== ANTHROPIC) return 0;
  const f = family(r.model);
  return (
    MULT[f] *
      (WEIGHTS.input * r.input_tokens +
        WEIGHTS.cacheWrite5m * r.cache_write_5m_tokens +
        WEIGHTS.cacheWrite1h * r.cache_write_1h_tokens +
        WEIGHTS.output * r.output_tokens) +
    READ[f] * r.cache_read_tokens
  );
}

export const CTX_LIMIT = 200_000;

// What the call sent: fresh input, cache writes and cache reads.
export const ctxOf = (r: TokenRow): number =>
  r.input_tokens +
  r.cache_read_tokens +
  r.cache_write_5m_tokens +
  r.cache_write_1h_tokens;

export const overLimit = (ctx: number | null) =>
  ctx !== null && ctx > CTX_LIMIT;
