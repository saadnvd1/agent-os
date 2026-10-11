/**
 * What a turn would cost at a provider's list prices (the price table in
 * Settings > Models). For Anthropic that's the API's price, not what the
 * plan charges: the plan's own measure is its share of the 5-hour window.
 */

import { ANTHROPIC_ALIASES, type ModelPrice } from "../models/providers";
import { ANTHROPIC } from "../models/roles";

export interface PricedRow {
  provider: string | null;
  model: string | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export const UNRECORDED = "unrecorded";

// The row's provider and model as the table names them: turns from before
// routing have neither, and ran on Anthropic.
export function rowModel(r: Pick<PricedRow, "provider" | "model">): {
  provider: string;
  model: string;
} {
  const provider = r.provider ?? ANTHROPIC;
  const raw = r.model ?? UNRECORDED;
  const model = provider === ANTHROPIC ? (ANTHROPIC_ALIASES[raw] ?? raw) : raw;
  return { provider, model };
}

// Dollars, and whether it came from the table (false: the agent's own
// figure, for a model the table doesn't price).
export function estimateCost(
  r: PricedRow,
  prices: Record<string, ModelPrice>
): { usd: number; priced: boolean } {
  const { provider, model } = rowModel(r);
  const p = prices[`${provider}/${model}`];
  if (!p) return { usd: r.cost_usd, priced: false };
  const usd =
    (r.input_tokens * p.input +
      r.cache_write_tokens * p.cacheWrite +
      r.cache_read_tokens * p.cacheRead +
      r.output_tokens * p.output) /
    1_000_000;
  return { usd, priced: true };
}

// Each Anthropic turn's share of the plan's 5-hour window, in points: how
// far the window moved since the turn before it (any session's) ended.
// Turns overlap, so one turn's share is rough; summed over many it isn't.
// A drop means the window reset, and all of the new reading is this turn's;
// the first reading has nothing to measure from.
export function planShares(
  rows: { at: number; provider: string | null; window_pct: number | null }[]
): number[] {
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.at - b.r.at);
  const out = new Array<number>(rows.length).fill(0);
  let prev: number | null = null;
  for (const { r, i } of order) {
    if ((r.provider ?? ANTHROPIC) !== ANTHROPIC || r.window_pct == null)
      continue;
    const pct = r.window_pct;
    out[i] = prev === null ? 0 : pct < prev ? pct : pct - prev;
    prev = pct;
  }
  return out;
}
