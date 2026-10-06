import type { JSONContent } from "@tiptap/core";
import type { List, ListItem, Nodes, Parents, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

// Markdown into the composer's document, the inverse of docToMarkdown. Text
// is taken from the source, not the parsed value, so escapes and anything
// the composer has no node for (headings, links, tables) come through as the
// characters that were typed.

type Mark = NonNullable<JSONContent["marks"]>[number];

const paragraph = (content: JSONContent[] = []): JSONContent =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };

const empties = (n: number): JSONContent[] =>
  Array.from({ length: Math.max(0, n) }, () => paragraph());

// Plain text, one paragraph per line: what plain mode holds.
export function textToDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: text
      .split("\n")
      .map((line) => paragraph(line ? [{ type: "text", text: line }] : [])),
  };
}

const startOf = (n: Nodes) =>
  n.position?.start ?? { line: 1, column: 1, offset: 0 };
const endOf = (n: Nodes) =>
  n.position?.end ?? { line: 1, column: 1, offset: 0 };

function parser(src: string) {
  const slice = (from: number, to: number, indent: number) =>
    src
      .slice(from, to)
      .split("\n")
      .map((line, i) =>
        i === 0 ? line : line.replace(new RegExp(`^ {0,${indent}}`), "")
      )
      .join("\n");

  const text = (raw: string, marks: Mark[]): JSONContent[] =>
    raw.split("\n").flatMap((part, i) => {
      const out: JSONContent[] =
        i > 0 ? [{ type: "hardBreak", ...(marks.length && { marks }) }] : [];
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
    if (node.type === "inlineCode")
      return [{ type: "text", text: node.value, marks: [{ type: "code" }] }];
    if (
      node.type === "strong" ||
      node.type === "emphasis" ||
      node.type === "delete"
    ) {
      const d =
        src.slice(s).match(node.type === "delete" ? /^~+/ : /^[*_]+/)?.[0] ??
        "";
      const size =
        node.type === "strong" ? 2 : node.type === "emphasis" ? 1 : d.length;
      const delim = d.slice(0, size);
      const type = { strong: "bold", emphasis: "italic", delete: "strike" }[
        node.type
      ];
      const mark: Mark =
        type === "strike" ? { type } : { type, attrs: { delim } };
      return inline(node, s + size, e - size, [...marks, mark], indent);
    }
    return text(slice(s, e, indent), marks);
  }

  const raw = (node: Nodes, indent: number): JSONContent[] =>
    slice(startOf(node).offset ?? 0, endOf(node).offset ?? 0, indent)
      .split("\n")
      .map((line) => paragraph(line ? [{ type: "text", text: line }] : []));

  function item(node: ListItem, type: string): JSONContent {
    const s = startOf(node);
    const marker =
      src.slice(s.offset).match(/^([-+*]|\d+[.)])( {1,4})?/)?.[0] ?? "- ";
    const content = flow(node.children, s.column - 1 + marker.length);
    if (content[0]?.type !== "paragraph") content.unshift(paragraph());
    const attrs =
      type === "taskItem" ? { attrs: { checked: Boolean(node.checked) } } : {};
    return { type, ...attrs, content };
  }

  function list(node: List, indent: number): JSONContent[] {
    if (node.ordered)
      return [
        {
          type: "orderedList",
          attrs: { start: node.start ?? 1 },
          content: node.children.map((i) => item(i, "listItem")),
        },
      ];
    const checks = node.children.filter(
      (i) => typeof i.checked === "boolean"
    ).length;
    if (checks === node.children.length)
      return [
        {
          type: "taskList",
          content: node.children.map((i) => item(i, "taskItem")),
        },
      ];
    if (checks) return raw(node, indent);
    const marker = src[startOf(node).offset ?? 0] ?? "-";
    return [
      {
        type: "bulletList",
        attrs: { marker },
        content: node.children.map((i) => item(i, "listItem")),
      },
    ];
  }

  function block(node: RootContent, indent: number): JSONContent[] {
    if (node.type === "paragraph") {
      const s = startOf(node);
      const from =
        indent === 0
          ? (s.offset ?? 0) - (s.column - 1)
          : (startOf(node.children[0]).offset ?? 0);
      const e = endOf(node).offset ?? 0;
      const to = e + (src.slice(e).match(/^[ \t]+(?=\n|$)/)?.[0].length ?? 0);
      return [paragraph(inline(node, from, to, [], indent))];
    }
    if (
      node.type === "code" &&
      /^\s*(`{3,}|~{3,})/.test(src.slice(startOf(node).offset))
    ) {
      const content = node.value
        ? [{ type: "text", text: node.value }]
        : undefined;
      return [
        {
          type: "codeBlock",
          attrs: { language: node.lang ?? null },
          ...(content && { content }),
        },
      ];
    }
    if (node.type === "list") return list(node, indent);
    return raw(node, indent);
  }

  // Blocks with the blank lines between them kept as empty paragraphs.
  function flow(children: RootContent[], indent: number): JSONContent[] {
    return children.flatMap((child, i) => {
      const converted = block(child, indent);
      if (i === 0) return converted;
      const prev = children[i - 1];
      const leaving =
        prev.type === "list" &&
        converted[0]?.content?.length &&
        converted[0].type === "paragraph"
          ? 1
          : 0;
      return [
        ...empties(startOf(child).line - endOf(prev).line - 1 - leaving),
        ...converted,
      ];
    });
  }

  return { flow };
}

export function markdownToDoc(markdown: string): JSONContent {
  const src = markdown.replace(/\r\n?/g, "\n");
  const tree = fromMarkdown(src, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  if (!tree.children.length) return textToDoc(src);
  const first = tree.children[0];
  const last = tree.children[tree.children.length - 1];
  const trailing = src.split("\n").length - endOf(last).line;
  return {
    type: "doc",
    content: [
      ...empties(startOf(first).line - 1),
      ...parser(src).flow(tree.children, 0),
      ...empties(trailing),
    ],
  };
}
