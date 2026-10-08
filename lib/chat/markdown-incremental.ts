import type { Root, RootContent } from "mdast";
import type { Parser, Plugin } from "unified";

// A streaming message is re-rendered with every word, and re-parsing a long
// answer full of code each time is most of that cost. A closed top-level code
// fence followed by a blank line can't change meaning as text is appended, so
// everything up to it is parsed once and reused; only the rest is parsed per
// render.

type Parse = (source: string, file: Parameters<Parser<Root>>[1]) => Root;

interface Prefix {
  source: string;
  offset: number;
  line: number;
  children: RootContent[];
}

// Link and footnote definitions apply to the whole document: a suffix that
// has one needs a full parse.
function hasDefinitions(node: Root | RootContent): boolean {
  return (
    node.type === "definition" ||
    node.type === "footnoteDefinition" ||
    ("children" in node && node.children.some(hasDefinitions))
  );
}

function shift(node: Root | RootContent, offset: number, lines: number) {
  if (node.position) {
    for (const point of [node.position.start, node.position.end]) {
      if (point.offset !== undefined) point.offset += offset;
      point.line += lines;
    }
  }
  if ("children" in node)
    for (const child of node.children) shift(child, offset, lines);
}

const OPENING = /^ {0,3}(`{3,}|~{3,})[^\n]*\n/;

export function incrementalParser(parse: Parse): Parse {
  let cached: Prefix | undefined;
  return (source, file) => {
    // A CR could become half of a CRLF and a BOM is stripped at the start:
    // either way the split point isn't safe.
    if (source.includes("\r") || source.includes("﻿"))
      return parse(source, file);

    const prefix =
      cached && source.startsWith(cached.source) ? cached : undefined;
    let root: Root;
    if (prefix) {
      root = parse(source.slice(prefix.offset), file);
      if (hasDefinitions(root)) return parse(source, file);
      shift(root, prefix.offset, prefix.line - 1);
      if (root.position)
        root.position.start = { line: 1, column: 1, offset: 0 };
      // Transforms mutate the tree: the cache keeps pristine nodes and each
      // render gets its own copy.
      root.children.unshift(...structuredClone(prefix.children));
    } else {
      root = parse(source, file);
      if (hasDefinitions(root)) return root;
    }

    for (let i = root.children.length - 1; i >= 0; i--) {
      const node = root.children[i];
      if (node?.type !== "code") continue;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      if (prefix && end < prefix.offset) break;
      const value = source.slice(start, end);
      const fence = OPENING.exec(value)?.[1];
      if (!fence) continue;
      const lastLine = value.slice(value.lastIndexOf("\n") + 1);
      const closing = new RegExp(
        `^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`
      );
      const blank = /^\n[ \t]*\n/.exec(source.slice(end))?.[0];
      if (!closing.test(lastLine) || !blank) continue;
      const offset = end + blank.length;
      cached = {
        source: source.slice(0, offset),
        offset,
        line: node.position!.end.line + 2,
        children: structuredClone(root.children.slice(0, i + 1)),
      };
      break;
    }
    return root;
  };
}

/** One per streaming message; a remark plugin that swaps in the parser above. */
export function incrementalMarkdown(): Plugin<[], Root> {
  let parser: Parse | undefined;
  return function () {
    const original = this.parser as Parse | undefined;
    if (!original) return;
    parser ??= incrementalParser((source, file) => original(source, file));
    const parseDocument = parser;
    // react-markdown builds a processor per render; its first parse is the
    // document. Any later parse on it is a transform's own text and must not
    // touch the document's cache.
    let parsed = false;
    this.parser = (source, file) => {
      if (parsed) return original(source, file);
      parsed = true;
      return parseDocument(source, file);
    };
  };
}
