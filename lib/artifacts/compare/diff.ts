// A line diff (Myers' O(ND)) with a word diff inside the changed lines that
// pair up. Bounded: past the limits it gives up instead of burning the CPU.

import type { DiffLine, DiffSummary, WordPart } from "./types";

export const MAX_LINES = 20_000;
// Edit distance past which two texts are different enough not to diff.
export const MAX_EDITS = 4_000;
const MAX_WORD_TOKENS = 600;

type Op = { t: "eq" | "add" | "del"; i: number; j: number };

// Edit script from a to b, or null when it needs more than maxEdits.
function myers(a: string[], b: string[], maxEdits: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const down =
      k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]);
    const pk = down ? k + 1 : k - 1;
    const px = prev[offset + pk];
    const py = px - pk;
    while (x > px && y > py) {
      x--;
      y--;
      ops.push({ t: "eq", i: x, j: y });
    }
    if (down) {
      y--;
      ops.push({ t: "add", i: x, j: y });
    } else {
      x--;
      ops.push({ t: "del", i: x, j: y });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ t: "eq", i: x, j: y });
  }
  return ops.reverse();
}

const tokens = (s: string) =>
  s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];

// The words of two paired lines: what each side kept and what it changed.
function wordParts(
  before: string,
  after: string
): { del: WordPart[]; add: WordPart[] } | null {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length > MAX_WORD_TOKENS || b.length > MAX_WORD_TOKENS) return null;
  const ops = myers(a, b, MAX_WORD_TOKENS);
  if (!ops) return null;
  const del: WordPart[] = [];
  const add: WordPart[] = [];
  const push = (list: WordPart[], t: WordPart["t"], s: string) => {
    const last = list[list.length - 1];
    if (last && last.t === t) last.s += s;
    else list.push({ t, s });
  };
  for (const op of ops) {
    if (op.t === "eq") {
      push(del, "eq", a[op.i]);
      push(add, "eq", b[op.j]);
    } else if (op.t === "del") push(del, "del", a[op.i]);
    else push(add, "add", b[op.j]);
  }
  return { del, add };
}

export type DiffResult =
  { ok: true; lines: DiffLine[]; summary: DiffSummary } | { ok: false };

export function diffLines(before: string, after: string): DiffResult {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) return { ok: false };
  const ops = myers(a, b, MAX_EDITS);
  if (!ops) return { ok: false };

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  for (let p = 0; p < ops.length;) {
    if (ops[p].t === "eq") {
      lines.push({ t: "eq", s: a[ops[p].i] });
      p++;
      continue;
    }
    // A run of changes: removals first, then additions, paired in order.
    const dels: string[] = [];
    const adds: string[] = [];
    while (p < ops.length && ops[p].t !== "eq") {
      if (ops[p].t === "del") dels.push(a[ops[p].i]);
      else adds.push(b[ops[p].j]);
      p++;
    }
    removed += dels.length;
    added += adds.length;
    const delLines: DiffLine[] = dels.map((s) => ({ t: "del", s }));
    const addLines: DiffLine[] = adds.map((s) => ({ t: "add", s }));
    for (let q = 0; q < Math.min(dels.length, adds.length); q++) {
      const w = wordParts(dels[q], adds[q]);
      if (w) {
        delLines[q].words = w.del;
        addLines[q].words = w.add;
      }
    }
    lines.push(...delLines, ...addLines);
  }
  return { ok: true, lines, summary: { added, removed } };
}

export function summaryLabel(s: DiffSummary): string {
  if (!s.added && !s.removed) return "No changes";
  return `+${s.added} −${s.removed} lines`;
}

export type Shown = DiffLine | { gap: number };

// Long unchanged stretches folded to a gap, keeping `context` lines around
// every change.
export function foldUnchanged(lines: DiffLine[], context = 3): Shown[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.t === "eq") return;
    for (
      let k = Math.max(0, i - context);
      k <= Math.min(lines.length - 1, i + context);
      k++
    )
      keep[k] = true;
  });
  const out: Shown[] = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap) out.push({ gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ gap });
  return out;
}
