// What a selection in the chat quotes: the parts of it inside replies
// (elements marked data-quotable), whatever its ends touch. A triple-click
// or a drag past a reply's last line ends the range outside the reply, in
// whatever follows it, so the ends alone can't say whether it's a quote.

export interface QuotePick {
  text: string;
  // The selection clipped to each reply it covers, for placing the button.
  ranges: Range[];
}

// Blank lines around paragraph-like blocks, a line break around the rest,
// as innerText lays them out.
const PARAS = new Set([
  "P",
  "PRE",
  "BLOCKQUOTE",
  "TABLE",
  "UL",
  "OL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
]);
const LINES = new Set(["DIV", "LI", "TR"]);

// A range's text with blocks on their own lines, as a native selection
// copies it (Range.toString runs paragraphs together).
export function rangeText(range: Range): string {
  let out = "";
  const brk = (n: number) => {
    if (!out) return;
    const have = out.length - out.replace(/\n+$/, "").length;
    if (have < n) out += "\n".repeat(n - have);
  };
  const walk = (node: Node) => {
    if (node.nodeType === node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    const tag = node.nodeType === node.ELEMENT_NODE ? node.nodeName : "";
    if (tag === "BR") out += "\n";
    const n = PARAS.has(tag) ? 2 : LINES.has(tag) ? 1 : 0;
    brk(n);
    node.childNodes.forEach(walk);
    brk(n);
  };
  walk(range.cloneContents());
  return out.trim();
}

function clipTo(range: Range, el: Element): Range {
  const clip = el.ownerDocument.createRange();
  clip.selectNodeContents(el);
  if (range.compareBoundaryPoints(range.START_TO_START, clip) > 0) {
    clip.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(range.END_TO_END, clip) < 0) {
    clip.setEnd(range.endContainer, range.endOffset);
  }
  return clip;
}

export function quotePick(sel: Selection, root: Element): QuotePick | null {
  if (sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const ranges = Array.from(root.querySelectorAll("[data-quotable]"))
    .filter((el) => range.intersectsNode(el))
    .map((el) => clipTo(range, el))
    .filter((r) => r.toString().trim());
  if (!ranges.length) return null;
  // Within one reply, with nothing selected outside it: the browser's own
  // text, which knows the layout best.
  const native = sel.toString();
  const only =
    ranges.length === 1 &&
    range.toString().trim() === ranges[0].toString().trim();
  const text =
    only && native.trim()
      ? native.trimEnd()
      : ranges.map(rangeText).join("\n\n");
  return text.trim() ? { text, ranges } : null;
}

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Placement {
  x: number;
  y: number;
  // Above the selection's top, or below its bottom when there's no room.
  side: "above" | "below";
}

// Where the floating button goes, kept inside the visible chat (`view`),
// which ends above the composer. Null when the selection is scrolled out.
export function placeQuote(sel: Box, view: Box, size = 48): Placement | null {
  if (sel.bottom < view.top || sel.top > view.bottom) return null;
  const half = 60;
  const mid = (sel.left + sel.right) / 2;
  const x = Math.min(Math.max(mid, view.left + half), view.right - half);
  if (sel.top - size >= view.top) return { x, y: sel.top, side: "above" };
  return {
    x,
    y: Math.max(Math.min(sel.bottom, view.bottom - size), view.top),
    side: "below",
  };
}
