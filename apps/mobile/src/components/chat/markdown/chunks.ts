// A reply split the way it's drawn: runs of prose become ONE selectable
// native text (so a selection can cross paragraphs), and code, tables,
// quotes and images are views of their own. Keys come from source offsets,
// so a streaming reply never remounts the chunks it already showed.
import type { Image, RootContent } from "mdast";

export type Chunk =
  | { kind: "prose"; key: string; nodes: RootContent[] }
  | { kind: "block"; key: string; node: RootContent }
  | { kind: "images"; key: string; images: Image[] };

const PROSE = new Set([
  "paragraph",
  "heading",
  "list",
  "html",
  "thematicBreak",
]);

const keyOf = (n: RootContent, i: number) =>
  `${n.type}:${n.position?.start.offset ?? `i${i}`}`;

// A paragraph that is only images (and whitespace) is drawn as images.
function imagesOf(n: RootContent): Image[] | null {
  if (n.type !== "paragraph") return null;
  const images = n.children.filter((c): c is Image => c.type === "image");
  const rest = n.children.filter(
    (c) => c.type !== "image" && !(c.type === "text" && !c.value.trim())
  );
  return images.length && !rest.length ? images : null;
}

export function chunk(nodes: RootContent[]): Chunk[] {
  const out: Chunk[] = [];
  nodes.forEach((n, i) => {
    const images = imagesOf(n);
    if (images) {
      out.push({ kind: "images", key: keyOf(n, i), images });
      return;
    }
    if (PROSE.has(n.type)) {
      const last = out[out.length - 1];
      if (last?.kind === "prose") last.nodes.push(n);
      else out.push({ kind: "prose", key: keyOf(n, i), nodes: [n] });
      return;
    }
    out.push({ kind: "block", key: keyOf(n, i), node: n });
  });
  return out;
}

// Every image a reply shows, in order, for the full-screen viewer.
export function imageUrls(nodes: RootContent[]): string[] {
  const urls: string[] = [];
  const walk = (n: RootContent) => {
    if (n.type === "image") urls.push(n.url);
    if ("children" in n) (n.children as RootContent[]).forEach(walk);
  };
  nodes.forEach(walk);
  return urls;
}
