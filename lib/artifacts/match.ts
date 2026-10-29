// Finds which earlier page a new render is a revision of, by its visible text.
// Used when an agent retitles a page without passing `update`.

// Word-5-gram overlap (Jaccard) of the visible text. A revision keeps most of
// its sentences, so it stays well above 0.6; two pages that only share a
// template (nav, footer, same CSS) have different text and land far below.
export const MATCH_THRESHOLD = 0.6;
// A clear winner: the runner-up must trail by this much, else it is a tie.
export const MATCH_MARGIN = 0.1;
// Too little text to tell documents apart.
export const MIN_TOKENS = 12;
export const SHINGLE = 5;
export const MAX_CANDIDATES = 20;

export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function tokens(html: string): string[] {
  return visibleText(html).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function shingles(toks: string[]): Set<string> {
  const out = new Set<string>();
  const n = Math.min(SHINGLE, toks.length);
  for (let i = 0; i + n <= toks.length; i++)
    out.add(toks.slice(i, i + n).join(" "));
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length < MIN_TOKENS || tb.length < MIN_TOKENS) return 0;
  const sa = shingles(ta);
  const sb = shingles(tb);
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  const union = sa.size + sb.size - shared;
  return union ? shared / union : 0;
}

// The id of the one candidate that clearly is the same document, if any.
export function findRevisionOf<T extends { key: string; html: string }>(
  html: string,
  candidates: T[]
): string | undefined {
  const scored = candidates
    .slice(0, MAX_CANDIDATES)
    .map((c) => ({ key: c.key, score: similarity(html, c.html) }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (!best || best.score < MATCH_THRESHOLD) return undefined;
  if (next && best.score - next.score < MATCH_MARGIN) return undefined;
  return best.key;
}
