// A PR body's "Scope change" note: a section headed "Scope change", or a
// paragraph that opens with "Scope change:" (bold or not). It's the
// author's claim; the reviewer honours it only where a scope change the
// orchestrator recorded backs it (orchestrator/review-prompt.ts).

import { renderedLines } from "./code-review";

const MAX = 4000;
// Line by line, never across lines, as in code-review.ts.
const HEADING = /^ {0,3}(#{1,6}) *[*_]{0,2}scope changes?[*_]{0,2} *:?$/i;
const ANY_HEADING = /^ {0,3}(#{1,6}) +\S/;
const LEAD = /^ {0,3}[*_]{0,2}scope changes?(?::[*_]{0,2}|[*_]{0,2} *:)/i;

export function parseScopeChange(
  body: string | null | undefined
): string | null {
  if (!body) return null;
  const found: string[][] = [];
  // In a section: its heading level; in a paragraph: -1.
  let level = 0;
  for (const line of renderedLines(body)) {
    const heading = HEADING.exec(line);
    if (heading) {
      level = heading[1].length;
      found.push([]);
      continue;
    }
    const other = ANY_HEADING.exec(line);
    if (level > 0 && other && other[1].length <= level) level = 0;
    if (level === -1 && (!line.trim() || other)) level = 0;
    if (!level && LEAD.test(line)) {
      level = -1;
      found.push([]);
    }
    if (level) found.at(-1)!.push(line);
  }
  const text = found
    .map((lines) => lines.join("\n").trim())
    .filter(Boolean)
    .join("\n\n");
  return text ? text.slice(0, MAX) : null;
}
