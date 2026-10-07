import type { ChatContext, UsageTotals } from "./events";

interface SdkContextUsage {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  model?: string;
  categories: { name: string; tokens: number; kind?: string }[];
}

// The agent's context report, measured against the room it has before it
// compacts on its own: the window less the compaction reserve, which on a
// 1M-token window is most of it.
export function toChatContext(
  u: SdkContextUsage,
  at = Date.now()
): ChatContext {
  const buffer = u.categories
    .filter((c) => c.kind === "buffer")
    .reduce((sum, c) => sum + c.tokens, 0);
  const maxTokens =
    buffer > 0 && buffer < u.maxTokens ? u.maxTokens - buffer : u.maxTokens;
  return {
    usedTokens: u.totalTokens,
    maxTokens,
    percentage:
      maxTokens > 0 ? Math.round((u.totalTokens / maxTokens) * 100) : 0,
    categories: u.categories
      .filter((c) => c.kind === "used" && c.tokens > 0)
      .map((c) => ({ name: c.name, tokens: c.tokens })),
    model: u.model,
    at,
  };
}

export type MeterLevel = "ok" | "warn" | "high";

// Amber past about 60%, red past about 85%.
export function meterLevel(percentage: number): MeterLevel {
  if (percentage >= 85) return "high";
  if (percentage >= 60) return "warn";
  return "ok";
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

type ModelUsage = Record<
  string,
  {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    costUSD?: number;
  }
>;

// The running totals a turn's result carries, summed over every model.
export function usageTotals(
  modelUsage: ModelUsage | undefined,
  totalCostUsd: number | undefined
): UsageTotals {
  const t: UsageTotals = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const m of Object.values(modelUsage ?? {})) {
    t.costUsd += m.costUSD ?? 0;
    t.inputTokens += m.inputTokens ?? 0;
    t.outputTokens += m.outputTokens ?? 0;
    t.cacheReadTokens += m.cacheReadInputTokens ?? 0;
    t.cacheWriteTokens += m.cacheCreationInputTokens ?? 0;
  }
  if (typeof totalCostUsd === "number" && totalCostUsd > 0)
    t.costUsd = totalCostUsd;
  return t;
}

export const totalTokens = (t: UsageTotals) =>
  t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;

// What one turn added. The totals run for the life of the agent process and
// a resumed one continues them, but a /clear or a resume without saved totals
// starts again from zero: a total lower than the last one is a fresh start,
// and all of it is this turn's.
export function turnDelta(
  prev: UsageTotals | null,
  next: UsageTotals
): UsageTotals {
  if (
    !prev ||
    next.costUsd < prev.costUsd ||
    totalTokens(next) < totalTokens(prev)
  )
    return { ...next };
  return {
    costUsd: next.costUsd - prev.costUsd,
    inputTokens: next.inputTokens - prev.inputTokens,
    outputTokens: next.outputTokens - prev.outputTokens,
    cacheReadTokens: next.cacheReadTokens - prev.cacheReadTokens,
    cacheWriteTokens: next.cacheWriteTokens - prev.cacheWriteTokens,
  };
}
