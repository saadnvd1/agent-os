// A unified diff as rows to draw: each line with its old and new line
// numbers, and long unchanged runs folded to the context around changes.
import type { DiffLine } from "@/lib/chat/diff";

export type DiffRow =
  | {
      kind: "line";
      op: DiffLine["op"];
      text: string;
      old: number | null;
      new: number | null;
    }
  | { kind: "fold"; count: number; from: number };

export const CONTEXT = 3;

export function numberLines(lines: DiffLine[]) {
  let a = 0;
  let b = 0;
  return lines.map((l) => ({
    op: l.op,
    text: l.text,
    old: l.op === "+" ? null : ++a,
    new: l.op === "-" ? null : ++b,
  }));
}

// Unchanged lines more than CONTEXT away from any change fold into one row.
export function diffRows(lines: DiffLine[], context = CONTEXT): DiffRow[] {
  const numbered = numberLines(lines);
  const near = numbered.map(() => false);
  numbered.forEach((l, i) => {
    if (l.op === " ") return;
    for (
      let k = Math.max(0, i - context);
      k <= Math.min(numbered.length - 1, i + context);
      k++
    )
      near[k] = true;
  });
  const rows: DiffRow[] = [];
  let run = 0;
  const flush = (i: number) => {
    if (run) rows.push({ kind: "fold", count: run, from: i - run });
    run = 0;
  };
  numbered.forEach((l, i) => {
    if (near[i]) {
      flush(i);
      rows.push({ kind: "line", ...l });
    } else run++;
  });
  flush(numbered.length);
  return rows;
}

export function unfold(
  lines: DiffLine[],
  from: number,
  count: number
): DiffRow[] {
  return numberLines(lines)
    .slice(from, from + count)
    .map((l) => ({ kind: "line" as const, ...l }));
}

export const extOf = (path: string) =>
  path.split(".").pop()?.toLowerCase() ?? "";
