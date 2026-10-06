import type { JSONContent } from "@tiptap/core";
import type { Nodes, Parents } from "mdast";

// Inline markdown into composer nodes. Text comes from the source, not the
// parsed value, so escapes, entities and anything without a node of its own
// (links, html) stay the characters that were typed.

// Marks a lazy continuation line, in source slices and in serialized output.
export const LAZY = "\u0000";

export type Mark = NonNullable<JSONContent["marks"]>[number];

export const startOf = (n: Nodes) =>
  n.position?.start ?? { line: 1, column: 1, offset: 0 };
export const endOf = (n: Nodes) =>
  n.position?.end ?? { line: 1, column: 1, offset: 0 };

export function inlineParser(src: string) {
  // Source between two offsets, continuation lines outdented to the
  // container's content column. A lazy line (indented less than that, which
  // markdown allows) is flagged, so it's written back unindented.
  const slice = (from: number, to: number, indent: number) =>
    src
      .slice(from, to)
      .split("\n")
      .map((line, i) => {
        if (i === 0 || !indent) return line;
        const lead = line.match(/^ */)?.[0].length ?? 0;
        return lead < indent && line.trim() ? LAZY + line : line.slice(indent);
      })
      .join("\n");

  const text = (raw: string, marks: Mark[]): JSONContent[] =>
    raw.split("\n").flatMap((line, i) => {
      const lazy = line.startsWith(LAZY);
      const part = lazy ? line.slice(1) : line;
      const br: JSONContent = {
        type: "hardBreak",
        ...(lazy && { attrs: { lazy } }),
        ...(marks.length && { marks }),
      };
      const out: JSONContent[] = i > 0 ? [br] : [];
      if (part)
        out.push({ type: "text", text: part, ...(marks.length && { marks }) });
      return out;
    });

  // Children of an inline container, with any source between them kept.
  function inline(
    parent: Parents,
    from: number,
    to: number,
    marks: Mark[],
    indent: number
  ): JSONContent[] {
    const out: JSONContent[] = [];
    let at = from;
    for (const child of parent.children as Nodes[]) {
      const s = startOf(child).offset ?? at;
      const e = endOf(child).offset ?? s;
      if (s > at) out.push(...text(slice(at, s, indent), marks));
      out.push(...phrasing(child, marks, indent));
      at = Math.max(at, e);
    }
    if (to > at) out.push(...text(slice(at, to, indent), marks));
    return out;
  }

  function phrasing(node: Nodes, marks: Mark[], indent: number): JSONContent[] {
    const s = startOf(node).offset ?? 0;
    const e = endOf(node).offset ?? s;
    if (node.type === "inlineCode") {
      // Kept with its own backticks and padding: `` a `` stays `` a ``.
      const raw = src.slice(s, e);
      const delim = raw.match(/^`+/)?.[0] ?? "`";
      const code = raw.slice(delim.length, raw.length - delim.length);
      if (!code || code.includes("\n")) return text(slice(s, e, indent), marks);
      return [
        {
          type: "text",
          text: code,
          marks: [{ type: "code", attrs: { delim } }],
        },
      ];
    }
    if (
      node.type === "strong" ||
      node.type === "emphasis" ||
      node.type === "delete"
    ) {
      const run =
        src.slice(s).match(node.type === "delete" ? /^~+/ : /^[*_]+/)?.[0] ??
        "";
      const size =
        node.type === "strong" ? 2 : node.type === "emphasis" ? 1 : run.length;
      const delim = run.slice(0, size);
      const type = { strong: "bold", emphasis: "italic", delete: "strike" }[
        node.type
      ];
      const mark: Mark = { type, attrs: { delim } };
      return inline(node, s + size, e - size, [...marks, mark], indent);
    }
    return text(slice(s, e, indent), marks);
  }

  return { slice, inline };
}
