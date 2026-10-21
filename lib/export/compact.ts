import type { ExportMode } from "./view";

// The compact rules, one table: the build reads it, and so do the tests
// (view.COMPACT_RULES says the same in words for the sheet).
export const COMPACT = {
  outputHead: 10,
  outputTail: 20,
  errorHead: 3,
  errorTail: 27,
  outputChars: 2_000,
  inputChars: 300,
  commandChars: 1_000,
  pasteOver: 8_000,
  pasteHead: 4_000,
  pasteTail: 2_000,
} as const;

export const FULL = {
  /** One runaway log must not decide the file's size. */
  fieldChars: 200_000,
  patchLines: 200,
} as const;

const WHY = { compact: "Compact export", full: "Full export" } as const;

export interface Trunc {
  field: string;
  how: string;
  totalLines: number;
  keptLines: number;
  totalChars: number;
  keptChars: number;
}

export interface Cut {
  text: string;
  truncated?: Trunc;
}

const lineCount = (s: string) => (s ? s.split("\n").length : 0);

const trunc = (
  field: string,
  how: string,
  original: string,
  keptLines: number,
  keptChars: number
): Trunc => ({
  field,
  how,
  totalLines: lineCount(original),
  keptLines,
  totalChars: original.length,
  keptChars,
});

/** The start and end of a text by characters, with a marker between. */
export function cutChars(
  text: string,
  head: number,
  tail: number,
  field: string,
  why: string
): Cut {
  if (text.length <= head + tail) return { text };
  const kept = head + tail;
  const shown = tail ? `first ${head} and last ${tail}` : `first ${head}`;
  const marker = `[truncated: showing ${shown} of ${text.length} characters; ${text.length - kept} characters omitted (${why})]`;
  const out = [text.slice(0, head), marker, tail ? text.slice(-tail) : ""]
    .filter(Boolean)
    .join("\n");
  return {
    text: out,
    truncated: trunc(
      field,
      tail ? `head${head}+tail${tail}chars` : `head${head}chars`,
      text,
      lineCount(text.slice(0, head)) +
        (tail ? lineCount(text.slice(-tail)) : 0),
      kept
    ),
  };
}

/** First `head` and last `tail` lines, with a marker; then the char limit. */
export function cutLines(
  text: string,
  head: number,
  tail: number,
  maxChars: number,
  field: string
): Cut {
  const lines = text.split("\n");
  let out = text;
  let how = "";
  if (lines.length > head + tail) {
    const omitted = lines.length - head - tail;
    out = [
      ...lines.slice(0, head),
      `[truncated: showing first ${head} and last ${tail} of ${lines.length} lines; ${omitted} lines omitted (${WHY.compact})]`,
      ...lines.slice(lines.length - tail),
    ].join("\n");
    how = `head${head}+tail${tail}`;
  }
  if (out.length > maxChars) {
    const h = Math.floor(maxChars / 4);
    out = cutChars(out, h, maxChars - h, field, WHY.compact).text;
    how = how ? `${how}+chars${maxChars}` : `head${h}+tail${maxChars - h}chars`;
  }
  if (!how) return { text };
  return {
    text: out,
    truncated: trunc(field, how, text, lineCount(out), out.length),
  };
}

/** Full mode: the start of one field, up to the field cap. */
const capChars = (text: string, field: string): Cut =>
  cutChars(
    text,
    FULL.fieldChars,
    0,
    field,
    `${FULL.fieldChars.toLocaleString("en-US")}-character field cap`
  );

/** A tool's or command's output, by mode. Errors keep their tail. */
export function cutOutput(
  text: string,
  mode: ExportMode,
  isError: boolean
): Cut {
  if (mode === "full") return capChars(text, "output");
  const head = isError ? COMPACT.errorHead : COMPACT.outputHead;
  const tail = isError ? COMPACT.errorTail : COMPACT.outputTail;
  return cutLines(text, head, tail, COMPACT.outputChars, "output");
}

/** A tool's input text; a shell command is kept longer. */
export function cutInput(
  text: string,
  mode: ExportMode,
  command: boolean
): Cut {
  if (mode === "full") return capChars(text, "input");
  const max = command ? COMPACT.commandChars : COMPACT.inputChars;
  return cutChars(text, max, 0, "input", WHY.compact);
}

/** Prose (a message, a plan, thinking): whole, unless it is a huge paste. */
export function cutText(text: string, mode: ExportMode, field = "text"): Cut {
  if (mode === "full") return capChars(text, field);
  return text.length > COMPACT.pasteOver
    ? cutChars(text, COMPACT.pasteHead, COMPACT.pasteTail, field, WHY.compact)
    : { text };
}
