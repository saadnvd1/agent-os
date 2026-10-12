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
  return parts;
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
