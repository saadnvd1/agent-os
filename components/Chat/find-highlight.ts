/**
 * Marks find's matches in the rendered conversation with the CSS Custom
 * Highlight API: ranges painted over the text, so markdown, code blocks and
 * React's own DOM are never rewritten. Browsers without it still scroll to
 * the match; they just don't paint it.
 */

import { occurrences } from "@/lib/chat/find";

// Where a match starts and ends, as [piece, offset] in a run of text pieces.
export interface Span {
  start: [number, number];
  end: [number, number];
}

// Matches across text split over several nodes (a highlighted code line is
// many spans), found as if the pieces were one string.
export function matchSpans(pieces: string[], query: string): Span[] {
  const starts: number[] = [];
  let text = "";
  for (const p of pieces) {
    starts.push(text.length);
    text += p;
  }
  // The piece holding position `i`; an end prefers the piece it closes.
  const at = (i: number, end: boolean): [number, number] => {
    let k = 0;
    for (let j = 0; j < pieces.length; j++) {
      if (starts[j] > i || (end && starts[j] === i && j > 0)) break;
      k = j;
    }
    return [k, i - starts[k]];
  };
  return occurrences(text, query).map((i) => ({
    start: at(i, false),
    end: at(i + query.length, true),
  }));
}

// The ranges `query` covers in `root`'s text.
export function findRanges(root: Node, query: string): Range[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if (n.nodeValue) nodes.push(n as Text);
  return matchSpans(
    nodes.map((n) => n.nodeValue ?? ""),
    query
  ).map(({ start, end }) => {
    const r = doc.createRange();
    r.setStart(nodes[start[0]], start[1]);
    r.setEnd(nodes[end[0]], end[1]);
    return r;
  });
}

// Every open find bar's marks, painted together: there's one registry.
const painted = new Map<object, { all: Range[]; current: Range | null }>();

function repaint() {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  const all = [...painted.values()];
  CSS.highlights.set("chat-find", new Highlight(...all.flatMap((p) => p.all)));
  CSS.highlights.set(
    "chat-find-current",
    new Highlight(...all.flatMap((p) => (p.current ? [p.current] : [])))
  );
}

export function paint(owner: object, all: Range[], current: Range | null) {
  painted.set(owner, { all, current });
  repaint();
}

export function unpaint(owner: object) {
  if (painted.delete(owner)) repaint();
}
