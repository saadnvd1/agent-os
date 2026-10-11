/**
 * Spend by model and by role over a window: tokens of each kind, turns,
 * and the estimated cost from the price table (lib/usage/cost).
 */

import { estimateCost, rowModel, UNRECORDED, type PricedRow } from "./cost";
import type { ModelPrice } from "../models/providers";

export interface ModelTurnRow extends PricedRow {
  at: number;
  role: string | null;
}

export interface TokenSpend {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turns: number;
  costUsd: number;
  // Some of its turns are on a model the price table doesn't list.
  unpriced: boolean;
}

export interface ModelSpend extends TokenSpend {
  provider: string;
  model: string;
}

export interface RoleSpend extends TokenSpend {
  role: string;
}

export interface SpendByModel {
  since: number;
  total: TokenSpend;
  models: ModelSpend[];
  roles: RoleSpend[];
}

export const emptySpend = (): TokenSpend => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 0,
  costUsd: 0,
  unpriced: false,
});

export function addRow(
  s: TokenSpend,
  r: PricedRow,
  prices: Record<string, ModelPrice>
): void {
  const cost = estimateCost(r, prices);
  s.inputTokens += r.input_tokens;
  s.outputTokens += r.output_tokens;
  s.cacheReadTokens += r.cache_read_tokens;
  s.cacheWriteTokens += r.cache_write_tokens;
  s.turns += 1;
  s.costUsd += cost.usd;
  s.unpriced ||= !cost.priced;
}

export function spendByModel(
  rows: ModelTurnRow[],
  since: number,
  prices: Record<string, ModelPrice>
): SpendByModel {
  const total = emptySpend();
  const models = new Map<string, ModelSpend>();
  const roles = new Map<string, RoleSpend>();
  for (const r of rows) {
    if (r.at < since) continue;
    const { provider, model } = rowModel(r);
    const mk = `${provider}/${model}`;
    if (!models.has(mk)) models.set(mk, { ...emptySpend(), provider, model });
    const role = r.role ?? UNRECORDED;
    if (!roles.has(role)) roles.set(role, { ...emptySpend(), role });
    for (const s of [total, models.get(mk)!, roles.get(role)!])
      addRow(s, r, prices);
  }
  const byCost = (a: TokenSpend, b: TokenSpend) => b.costUsd - a.costUsd;
  return {
    since,
    total,
    models: [...models.values()].sort(byCost),
    roles: [...roles.values()].sort(byCost),
  };
}

export function sumSpend(xs: TokenSpend[]): TokenSpend {
  const t = emptySpend();
  for (const x of xs) {
    t.inputTokens += x.inputTokens;
    t.outputTokens += x.outputTokens;
    t.cacheReadTokens += x.cacheReadTokens;
    t.cacheWriteTokens += x.cacheWriteTokens;
    t.turns += x.turns;
    t.costUsd += x.costUsd;
    t.unpriced ||= x.unpriced;
  }
  return t;
}
