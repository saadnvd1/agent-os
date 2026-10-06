import type { JSONContent } from "@tiptap/core";
import type { List, ListItem, Nodes, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { endOf, inlineParser, LAZY, startOf } from "./inline";
import { docToMarkdown, LISTS } from "./serialize";

// Markdown into the composer's document, the inverse of docToMarkdown, and
// exact: each block keeps the shape it was written in (list markers and
// numbering, fences, spacing), and a block that wouldn't serialize back to
// the same characters stays as plain text lines instead.

const paragraph = (content: JSONContent[] = []): JSONContent =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };

const empties = (n: number): JSONContent[] =>
  Array.from({ length: Math.max(0, n) }, () => paragraph());

const lines = (text: string): JSONContent[] =>
  text
    .split("\n")
    .map((line) => paragraph(line ? [{ type: "text", text: line }] : []));

// Plain text, one paragraph per line: what plain mode holds.
export function textToDoc(text: string): JSONContent {
  return { type: "doc", content: lines(text) };
}

const MARKER = /^([-+*]|\d+[.)])( +|$)/;

function parser(src: string) {
  const { slice, inline } = inlineParser(src);
  const raw = (node: Nodes, indent: number) =>
    lines(
      slice(startOf(node).offset ?? 0, endOf(node).offset ?? 0, indent)
        .split(LAZY)
        .join("")
    );
  const markerOf = (item: ListItem) =>
    src.slice(startOf(item).offset).match(MARKER)?.[1] ?? "-";

  // Blank lines between items: the same everywhere, or the list isn't kept.
  function gap(node: List): number | null {
    const gaps = node.children
      .slice(1)
      .map((it, i) => startOf(it).line - endOf(node.children[i]).line - 1);
    return gaps.every((g) => g === (gaps[0] ?? 0)) ? (gaps[0] ?? 0) : null;
  }

  function item(node: ListItem, type: string): JSONContent {
    const s = startOf(node);
    const head = src.slice(s.offset).match(MARKER)?.[0] ?? "- ";
    const content = flow(node.children, s.column - 1 + head.length);
    if (content[0]?.type !== "paragraph") content.unshift(paragraph());
    const attrs =
      type === "taskItem" ? { attrs: { checked: Boolean(node.checked) } } : {};
    return { type, ...attrs, content };
  }

  function list(node: List, indent: number): JSONContent[] {
    const spacing = gap(node);
    if (spacing === null) return raw(node, indent);
    const markers = node.children.map(markerOf);
    if (node.ordered) {
      const start = node.start ?? 1;
      const numbers = markers.map((m) => parseInt(m, 10));
      const repeat = numbers.length > 1 && numbers.every((n) => n === start);
      return [
        {
          type: "orderedList",
          attrs: { start, delim: markers[0].slice(-1), repeat, gap: spacing },
          content: node.children.map((i) => item(i, "listItem")),
        },
      ];
    }
    const checks = node.children.filter((i) => typeof i.checked === "boolean");
    if (checks.length && checks.length < node.children.length)
      return raw(node, indent);
    const type = checks.length ? "taskList" : "bulletList";
    return [
      {
        type,
        attrs: { marker: markers[0], gap: spacing },
        content: node.children.map((i) =>
          item(i, checks.length ? "taskItem" : "listItem")
        ),
      },
    ];
  }

  function code(node: Nodes & { type: "code" }): JSONContent[] | null {
    const first = src.slice(startOf(node).offset).split("\n")[0];
    const fence = first.match(/^(`{3,}|~{3,})/)?.[0];
    if (!fence) return null;
    const info = first.slice(fence.length);
    const content = node.value ? [{ type: "text", text: node.value }] : [];
    return [
      {
        type: "codeBlock",
        attrs: {
          language: node.lang ?? null,
          fence,
          info: info === (node.lang ?? "") ? null : info,
        },
        ...(content.length && { content }),
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
    if (node.type === "code") return code(node) ?? raw(node, indent);
    if (node.type === "list") return list(node, indent);
    return raw(node, indent);
  }

  // Top level only: a block is kept as nodes when they write back the very
  // characters it came from.
  function checked(node: RootContent): JSONContent[] {
    const converted = block(node, 0);
    const s = startOf(node);
    const from = (s.offset ?? 0) - (s.column - 1);
    const source = src.slice(from, endOf(node).offset ?? 0);
    const back = docToMarkdown({ type: "doc", content: converted });
    return back === source ? converted : lines(source);
  }

  // Blocks with the blank lines between them kept as empty paragraphs.
  function flow(children: RootContent[], indent: number): JSONContent[] {
    const out: JSONContent[] = [];
    children.forEach((child, i) => {
      const converted = indent === 0 ? checked(child) : block(child, indent);
      if (i > 0) {
        const prev = out[out.length - 1];
        const leaving =
          LISTS.has(prev?.type ?? "") &&
          converted[0]?.type === "paragraph" &&
          converted[0].content?.length
            ? 1
            : 0;
        const blank = startOf(child).line - endOf(children[i - 1]).line - 1;
        out.push(...empties(blank - leaving));
      }
      out.push(...converted);
    });
    return out;
  }

  return { flow };
}

function parse(src: string): JSONContent {
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

// Whatever happens, what comes back serializes to the same string: if the
// document as a whole doesn't, it's taken as plain text.
export function markdownToDoc(markdown: string): JSONContent {
  const src = markdown.replace(/\r\n?/g, "\n");
  const doc = parse(src);
  return docToMarkdown(doc) === src ? doc : textToDoc(src);
}
