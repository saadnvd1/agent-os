export interface MatchQuery {
  // An FTS5 MATCH expression.
  match: string;
  // The words typed, lowercased, for marking a preview.
  terms: string[];
}

const HAS_WORD = /[\p{L}\p{N}]/u;
const WORDS = /[\p{L}\p{N}_]+/gu;
// A quoted phrase (possibly still being typed) or a bare word.
const TOKEN = /"([^"]*)(")?|[^\s"]+/g;

// What was typed as an FTS5 expression. Every piece goes in as a quoted
// string, so FTS syntax typed by hand (AND, NEAR, *, :, -, parentheses) is
// plain text. Bare words match as prefixes, so a word being typed finds its
// completions; a closed "phrase" is exact, an open one is a prefix on its last
// word. Null when nothing searchable was typed.
export function buildMatchQuery(input: string): MatchQuery | null {
  const parts: string[] = [];
  const terms: string[] = [];
  for (const m of input.matchAll(TOKEN)) {
    const quoted = m[1] !== undefined;
    const text = (quoted ? m[1] : m[0]).trim();
    if (!HAS_WORD.test(text)) continue;
    const prefix = !quoted || !m[2];
    parts.push(`"${text}"${prefix ? "*" : ""}`);
    for (const w of text.toLowerCase().match(WORDS) ?? []) terms.push(w);
  }
  if (!parts.length || terms.join("").length < 2) return null;
  return { match: parts.join(" "), terms };
}
