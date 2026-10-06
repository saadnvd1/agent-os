import type { JSONContent } from "@tiptap/core";
import { codeSpan, fenceFor } from "./fence";
import { LAZY } from "./inline";

// The composer's document back to the markdown it was typed as. Text is
// written as is, never escaped: a literal "*" the user typed reaches the
// agent as "*". Each block is one line group; blocks are joined by "\n", so
// an empty paragraph is a blank line.

type Mark = NonNullable<JSONContent["marks"]>[number];

const DELIMS: Record<string, string> = {
  bold: "**",
  italic: "_",
  strike: "~~",
};
export const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

const delim = (mark: Mark): string =>
  typeof mark.attrs?.delim === "string" ? mark.attrs.delim : DELIMS[mark.type];

const styling = (node: JSONContent): Mark[] =>
  (node.marks ?? []).filter((m) => m.type in DELIMS);

// How many nodes from `i` on carry this mark: longer runs open first, so
// they wrap the shorter ones.
function runLength(nodes: JSONContent[], i: number, type: string): number {
  let n = 0;
  while (
    i + n < nodes.length &&
    styling(nodes[i + n]).some((m) => m.type === type)
  )
    n++;
  return n;
}

function leaf(node: JSONContent): string {
  if (node.type === "hardBreak") return node.attrs?.lazy ? `\n${LAZY}` : "\n";
  const text = node.text ?? "";
  const code = node.marks?.find((m) => m.type === "code");
  if (!code) return text;
  // Written with the backticks it was typed with, while they still fit.
  const delim = code.attrs?.delim;
  return typeof delim === "string" && !text.includes(delim)
    ? `${delim}${text}${delim}`
    : codeSpan(text);
}

function inline(nodes: JSONContent[] = []): string {
  let out = "";
  const open: Mark[] = [];
  nodes.forEach((node, i) => {
    const marks = styling(node);
    const has = (m: Mark) => marks.some((x) => x.type === m.type);
    let keep = 0;
    while (keep < open.length && has(open[keep])) keep++;
    while (open.length > keep) out += delim(open.pop() as Mark);
    const fresh = marks
      .filter((m) => !open.some((o) => o.type === m.type))
      .sort(
        (a, b) => runLength(nodes, i, b.type) - runLength(nodes, i, a.type)
      );
    for (const m of fresh) {
      out += delim(m);
      open.push(m);
    }
    out += leaf(node);
  });
  while (open.length) out += delim(open.pop() as Mark);
  return out;
}

function item(node: JSONContent, prefix: string, indent: number): string {
  const pad = " ".repeat(indent);
  return blocks(node.content)
    .split("\n")
    .map((line, i) =>
      i === 0
        ? prefix + line
        : line.startsWith(LAZY)
          ? line
          : line && pad + line
    )
    .join("\n");
}

function list(node: JSONContent): string {
  const items = node.content ?? [];
  const a = node.attrs ?? {};
  const join = "\n".repeat(1 + Number(a.gap ?? 0));
  if (node.type === "orderedList") {
    const start = Number(a.start ?? 1);
    return items
      .map((it, i) => {
        const marker = `${a.repeat ? start : start + i}${a.delim ?? "."} `;
        return item(it, marker, marker.length);
      })
      .join(join);
  }
  const marker = `${a.marker ?? "-"} `;
  if (node.type === "taskList")
    return items
      .map((it) => item(it, `${marker}[${it.attrs?.checked ? "x" : " "}] `, 2))
      .join(join);
  return items.map((it) => item(it, marker, 2)).join(join);
}

// A fence of the same kind it was typed with, unless the code would close it.
function fenceOf(code: string, typed: unknown): string {
  if (typeof typed !== "string" || !typed) return fenceFor(code);
  const runs = code.match(new RegExp(`^ {0,3}\\${typed[0]}{3,}`, "gm")) ?? [];
  return runs.some((r) => r.trim().length >= typed.length)
    ? fenceFor(code)
    : typed;
}

function block(node: JSONContent): string {
  if (LISTS.has(node.type ?? "")) return list(node);
  if (node.type === "codeBlock") {
    const code = (node.content ?? []).map((n) => n.text ?? "").join("");
    const fence = fenceOf(code, node.attrs?.fence);
    const info = node.attrs?.info ?? node.attrs?.language ?? "";
    return code
      ? `${fence}${info}\n${code}\n${fence}`
      : `${fence}${info}\n${fence}`;
  }
  if (node.type === "paragraph") return inline(node.content);
  return blocks(node.content);
}

// Text right after a list needs a blank line, or markdown reads it as part
// of the last item; it's also what you'd type to leave a list. An empty
// paragraph there already is that blank line.
function blocks(nodes: JSONContent[] = []): string {
  return nodes
    .map((node, i) => {
      if (i === 0) return block(node);
      const leaving =
        LISTS.has(nodes[i - 1].type ?? "") &&
        node.type === "paragraph" &&
        Boolean(node.content?.length);
      return (leaving ? "\n\n" : "\n") + block(node);
    })
    .join("");
}

export function docToMarkdown(doc: JSONContent): string {
  return blocks(doc.content).split(LAZY).join("");
}
