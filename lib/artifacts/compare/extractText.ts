// The text a reader sees on a page, one block per line: scripts, styles and
// the head gone, headings, paragraphs, list items and table cells each on
// their own line.

const DROPPED =
  /<(script|style|noscript|template|head|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const BREAKING =
  /<\/?(?:p|div|section|article|aside|header|footer|main|nav|ul|ol|li|dl|dt|dd|h[1-6]|tr|td|th|table|thead|tbody|tfoot|caption|blockquote|pre|figure|figcaption|form|fieldset|details|summary|hr|br|address|label|button|option)\b[^>]*>/gi;
const TAGS = /<[^>]*>/g;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  times: "×",
  rarr: "→",
  larr: "←",
  copy: "©",
};

function codePoint(n: number, whole: string): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  } catch {
    return whole;
  }
}

export function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g,
    (whole, dec, hex, name) => {
      if (dec) return codePoint(parseInt(dec, 10), whole);
      if (hex) return codePoint(parseInt(hex, 16), whole);
      return NAMED[name.toLowerCase()] ?? whole;
    }
  );
}

export function extractText(html: string): string {
  const flat = html
    .replace(COMMENTS, "")
    .replace(DROPPED, "")
    .replace(BREAKING, "\n")
    .replace(TAGS, "");
  return decodeEntities(flat)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
