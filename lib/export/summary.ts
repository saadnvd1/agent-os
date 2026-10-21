import { addHits, noHits } from "../share/redact";
import type { Counts, ExportDoc, ExportTurn } from "./build";
import { inRange, resolveRange } from "./turns";
import {
  maskedList,
  type ExportMode,
  type ExportRange,
  type ExportRedact,
  type Hits,
} from "./view";

export interface Selected {
  doc: ExportDoc;
  turns: ExportTurn[];
  sel: { from: number; to: number; of: number };
  hits: Hits;
  omissions: Counts;
  truncations: Counts;
}

export interface ExportInfo {
  mode: ExportMode;
  redact: ExportRedact;
  generatedAt: string;
}

const sum = (parts: Counts[]) => {
  const out: Counts = {};
  for (const p of parts)
    for (const [k, v] of Object.entries(p)) out[k] = (out[k] ?? 0) + v;
  return out;
};

/** The turns a range means, with the counts for just those. */
export function selectTurns(doc: ExportDoc, range?: ExportRange): Selected {
  const sel = resolveRange(doc.turns, range);
  const turns = doc.turns.filter((t) => inRange(t.n, sel));
  return {
    doc,
    turns,
    sel,
    hits: turns.reduce((h, t) => addHits(h, t.hits), doc.metaHits),
    omissions: sum(turns.map((t) => t.omitted)),
    truncations: sum(turns.map((t) => t.truncated)),
  };
}

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

export const countList = (c: Counts) =>
  Object.entries(c)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => plural(n, what))
    .join(", ");

const NOTHING = noHits();
export { NOTHING };

/** The lines every format prints under "Export notes". */
export function exportNotes(s: Selected, info: ExportInfo) {
  const { from, to, of } = s.sel;
  const n = s.turns.filter((t) => t.n > 0).length;
  const first = s.turns[0]?.startedAt.slice(0, 16).replace("T", " ");
  const last = s.turns[s.turns.length - 1]?.endedAt
    .slice(0, 16)
    .replace("T", " ");
  const whole = from <= 1 && to >= of;
  const range = whole
    ? `Whole session, ${plural(of, "turn")}${first ? `, ${first} to ${last}` : ""}`
    : `Turns ${from}–${to} of ${of} (${plural(n, "turn")}), ${first} to ${last}`;
  const masked = maskedList(s.hits);
  return {
    range,
    detail:
      info.mode === "compact"
        ? "Compact: thinking dropped; tool output cut to its first 10 and last 20 lines; file changes reduced to counts"
        : "Full: nothing dropped except what the notes below list",
    redaction:
      (info.redact === "all"
        ? "Credentials, home paths, addresses, machine names and emails are masked"
        : "Credentials are masked; paths, machine names and emails are included") +
      (masked ? `. Masked: ${masked}` : ""),
    omitted: countList(s.omissions) || "nothing",
    truncated: countList(s.truncations) || "nothing",
  };
}
