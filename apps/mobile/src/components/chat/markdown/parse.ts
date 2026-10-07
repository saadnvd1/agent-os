import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

const cache = new Map<string, Root>();

// Parsing is cheap but streaming re-renders often; the last few results are
// kept so unchanged messages never parse twice.
export function parseMarkdown(text: string): Root {
  const hit = cache.get(text);
  if (hit) return hit;
  const tree = fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  cache.set(text, tree);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return tree;
}
