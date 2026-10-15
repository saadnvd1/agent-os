export type UserTextPart =
  | { kind: "text"; text: string }
  | { kind: "code"; code: string; language?: string };

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)[^\n`]*$/;

// A sent message split at its fenced code blocks. Everything else stays the
// text it was typed as: no emphasis, no HTML, no reflow. An unclosed fence
// runs to the end, as in markdown.
export function splitUserText(text: string): UserTextPart[] {
  if (!text.includes("```") && !text.includes("~~~"))
    return [{ kind: "text", text }];
  const parts: UserTextPart[] = [];
  let prose: string[] = [];
  let code: string[] | null = null;
  let fence = "";
  let language: string | undefined;
  const flushProse = () => {
    if (prose.length) parts.push({ kind: "text", text: prose.join("\n") });
    prose = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (code === null) {
      const m = OPEN.exec(line);
      if (m) {
        flushProse();
        code = [];
        fence = m[1];
        language = m[2] || undefined;
      } else prose.push(line);
      continue;
    }
    const t = line.trim();
    if (
      t.startsWith(fence[0]) &&
      t.length >= fence.length &&
      !/[^`~]/.test(t) &&
      t[0] === fence[0]
    ) {
      parts.push({ kind: "code", code: code.join("\n"), language });
      code = null;
    } else code.push(line);
  }
  if (code !== null)
    parts.push({ kind: "code", code: code.join("\n"), language });
  flushProse();
  // A block carries its own margin: the line breaks around it would show as
  // blank lines on top of that, in a bubble that keeps its line breaks.
  return parts
    .map((p, i) =>
      p.kind === "text"
        ? {
            ...p,
            text: p.text
              .replace(parts[i - 1]?.kind === "code" ? /^\n+/ : /^$/, "")
              .replace(parts[i + 1]?.kind === "code" ? /\n+$/ : /^$/, ""),
          }
        : p
    )
    .filter((p) => p.kind === "code" || p.text !== "");
}

// Backtick spans inside prose, split out so they can be set in monospace.
export function splitInlineCode(
  text: string
): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(/(`+)(?!`)([^\n]*?[^`\n])\1(?!`)/g)) {
    if (m.index > last)
      out.push({ code: false, text: text.slice(last, m.index) });
    out.push({ code: true, text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last) });
  return out;
}

export type ProsePart =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string };

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?]$/;

// Punctuation that ends a sentence, or a closing paren with no opener in the
// URL, belongs to the text around it.
function trimUrl(url: string): string {
  for (;;) {
    if (TRAILING.test(url)) url = url.slice(0, -1);
    else if (url.endsWith(")") && count(url, ")") > count(url, "("))
      url = url.slice(0, -1);
    else return url;
  }
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

// http(s) URLs in plain text, split out so they can be links.
export function splitLinks(text: string): { link: boolean; text: string }[] {
  const out: { link: boolean; text: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    if (!/^https?:\/\/[^/?#]+/i.test(url)) continue;
    if (m.index > last)
      out.push({ link: false, text: text.slice(last, m.index) });
    out.push({ link: true, text: url });
    last = m.index + url.length;
  }
  if (last < text.length) out.push({ link: false, text: text.slice(last) });
  return out;
}

// Prose split into code spans, links and the text between. Links are only
// looked for outside code spans.
export function splitProse(text: string): ProsePart[] {
  return splitInlineCode(text).flatMap((p): ProsePart[] =>
    p.code
      ? [{ kind: "code", text: p.text }]
      : splitLinks(p.text).map((l) => ({
          kind: l.link ? "link" : "text",
          text: l.text,
        }))
  );
}
