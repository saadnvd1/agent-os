// Prism tokens (the web's highlighter) grouped into lines, for native Text.
import { refractor } from "refractor";
import type { Element, Root, RootContent } from "hast";

export interface Token {
  text: string;
  types: string[];
}
export type Line = Token[];

const ALIASES: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  ts: "typescript",
  js: "javascript",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  md: "markdown",
};

export const languageOf = (lang?: string | null) => {
  const l = (lang ?? "").toLowerCase();
  const name = ALIASES[l] ?? l;
  return name && refractor.registered(name) ? name : null;
};

function flatten(nodes: RootContent[], types: string[], out: Token[]) {
  for (const n of nodes) {
    if (n.type === "text") out.push({ text: n.value, types });
    else if (n.type === "element") {
      const cls =
        ((n as Element).properties?.className as string[] | undefined) ?? [];
      flatten(
        n.children as RootContent[],
        [...types, ...cls.filter((c) => c !== "token")],
        out
      );
    }
  }
}

function toLines(tokens: Token[]): Line[] {
  const lines: Line[] = [[]];
  for (const tok of tokens) {
    const parts = tok.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, types: tok.types });
    });
  }
  return lines;
}

const plain = (code: string): Line[] =>
  code.split("\n").map((l) => (l ? [{ text: l, types: [] }] : []));

// Recent results, so re-renders and streamed prefixes never highlight twice.
const cache = new Map<string, Line[]>();
const CACHE_MAX = 100;

export function highlight(code: string, lang?: string | null): Line[] {
  const name = languageOf(lang);
  if (!name) return plain(code);
  const key = `${name}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let lines: Line[];
  try {
    const tree = refractor.highlight(code, name) as Root;
    const tokens: Token[] = [];
    flatten(tree.children, [], tokens);
    lines = toLines(tokens);
  } catch {
    lines = plain(code);
  }
  cache.set(key, lines);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return lines;
}

// While a reply streams, finished lines keep their colours and the line
// still being written stays plain until it ends: earlier lines never flicker.
export function highlightStreaming(code: string, lang?: string | null): Line[] {
  const cut = code.lastIndexOf("\n");
  if (cut < 0) return plain(code);
  const done = highlight(code.slice(0, cut), lang);
  return [...done, ...plain(code.slice(cut + 1))];
}
