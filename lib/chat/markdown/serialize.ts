import type { JSONContent } from "@tiptap/core";
import { codeSpan, fenceFor } from "./fence";

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
const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

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
  if (node.type === "hardBreak") return "\n";
  const text = node.text ?? "";
  return node.marks?.some((m) => m.type === "code") ? codeSpan(text) : text;
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
    .map((line, i) => (i === 0 ? prefix + line : line && pad + line))
    .join("\n");
}

function list(node: JSONContent): string {
  const items = node.content ?? [];
  if (node.type === "taskList")
    return items
      .map((it) => item(it, `- [${it.attrs?.checked ? "x" : " "}] `, 2))
      .join("\n");
  if (node.type === "orderedList") {
    const start = Number(node.attrs?.start ?? 1);
    return items
      .map((it, i) => {
        const marker = `${start + i}. `;
        return item(it, marker, marker.length);
      })
      .join("\n");
  }
  const marker = `${node.attrs?.marker ?? "-"} `;
  return items.map((it) => item(it, marker, 2)).join("\n");
}

function block(node: JSONContent): string {
  if (LISTS.has(node.type ?? "")) return list(node);
  if (node.type === "codeBlock") {
    const code = (node.content ?? []).map((n) => n.text ?? "").join("");
    const fence = fenceFor(code);
    const lang = node.attrs?.language ?? "";
    return code
      ? `${fence}${lang}\n${code}\n${fence}`
      : `${fence}${lang}\n${fence}`;
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
  return blocks(doc.content);
}
