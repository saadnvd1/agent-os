/**
 * Which model a subagent runs on, by its type. Read-only search (Explore)
 * runs on Haiku; anything that plans, decides or reviews on Sonnet, and
 * never on Haiku. Imported by the browser too, so no Node modules here.
 */

export const SUBAGENT_TIERS = ["haiku", "sonnet", "opus", "inherit"] as const;
export type SubagentTier = (typeof SUBAGENT_TIERS)[number];

// Subagent type (or "prefix*") to tier. "inherit" leaves a call on the
// session's model.
export type SubagentModels = Record<string, SubagentTier>;

export const DEFAULT_SUBAGENT_MODELS: SubagentModels = {
  Explore: "haiku",
  Plan: "sonnet",
  "general-purpose": "sonnet",
  "review-*": "sonnet",
};

// Types that plan, decide or review: Settings can't put these on Haiku.
export const NEVER_HAIKU = ["Plan", "general-purpose", "review-*"];

export const TIER_LABELS: Record<SubagentTier, string> = {
  haiku: "Haiku 4.5",
  sonnet: "Sonnet 5.5",
  opus: "Opus 5.5",
  inherit: "Same as the session",
};

export const SUBAGENT_PATTERN = /^[A-Za-z0-9:_-]{1,80}\*?$/;

// Whether a pattern could match a type that must not run on Haiku.
export function mustNotBeHaiku(pattern: string): boolean {
  const wild = pattern.endsWith("*");
  const p = wild ? pattern.slice(0, -1) : pattern;
  return NEVER_HAIKU.some((n) => {
    const q = n.endsWith("*") ? n.slice(0, -1) : null;
    if (q === null) return wild ? n.startsWith(p) : n === p;
    return wild ? p.startsWith(q) || q.startsWith(p) : p.startsWith(q);
  });
}
