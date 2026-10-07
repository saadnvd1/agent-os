// A terminal's OSC 7501 records and the one status they add up to. Pure:
// no database, no tmux (lib/program-status/store.ts keeps them).
import type { BlockedKind, ProgramState, Report } from "./parse";

export interface ProgramRecord {
  id: string;
  state: ProgramState;
  kind?: BlockedKind;
  app?: string;
  progress?: number;
  msg?: string;
  title?: string;
  at: number;
  // The pane's foreground program when it reported working or blocked:
  // those records end when that program does.
  fg?: string;
}

export type Records = Record<string, ProgramRecord>;

// Fewer than the spec's 256; it allows 64.
export const MAX_RECORDS = 64;

const under = (id: string, root: string) =>
  root === "" || id === root || id.startsWith(root + "/");

/** The records after one report. */
export function applyReport(
  records: Records,
  report: Report,
  now: number,
  fg?: string
): Records {
  if (report.state === "clear") {
    return Object.fromEntries(
      Object.entries(records).filter(([id]) => !under(id, report.id))
    );
  }
  // A report replaces its record whole: a key it leaves out is gone.
  const record: ProgramRecord = { ...report, state: report.state, at: now };
  if (fg && (report.state === "working" || report.state === "blocked"))
    record.fg = fg;
  const next: Records = { ...records, [report.id]: record };
  const ids = Object.keys(next);
  if (ids.length > MAX_RECORDS) {
    const oldest = ids
      .filter((id) => id !== report.id)
      .reduce((a, b) => (next[a].at <= next[b].at ? a : b));
    delete next[oldest];
  }
  return next;
}

const transient = (r: ProgramRecord) =>
  r.state === "working" || r.state === "blocked";

/**
 * Working and blocked last only as long as the program that reported them.
 * A new shell prompt drops them all. Given the pane's foreground program as
 * seen at `seenAt`, those reported before then by a different one go. Done,
 * error and idle stay.
 */
export function dropTransient(
  records: Records,
  foreground?: string,
  seenAt = Infinity
): Records {
  return Object.fromEntries(
    Object.entries(records).filter(
      ([, r]) =>
        !transient(r) ||
        (foreground !== undefined &&
          (!r.fg || r.fg === foreground || r.at >= seenAt))
    )
  );
}

export interface ProgramSummary {
  state: ProgramState;
  kind?: BlockedKind;
  app?: string;
  progress?: number;
  msg?: string;
  at: number;
}

// The spec leaves combining records to the terminal: what needs you first,
// then a failure, then work in progress.
const RANK: Record<ProgramState, number> = {
  blocked: 4,
  error: 3,
  working: 2,
  done: 1,
  idle: 0,
};

function appOf(records: Records, id: string): string | undefined {
  for (let path = id; ; ) {
    const app = records[path]?.app;
    if (app) return app;
    if (path === "") return undefined;
    const slash = path.lastIndexOf("/");
    path = slash === -1 ? "" : path.slice(0, slash);
  }
}

/** The status a terminal's records add up to; null when it has none. */
export function summarize(records: Records): ProgramSummary | null {
  let top: ProgramRecord | null = null;
  for (const r of Object.values(records)) {
    if (
      !top ||
      RANK[r.state] > RANK[top.state] ||
      (RANK[r.state] === RANK[top.state] && r.at > top.at)
    )
      top = r;
  }
  if (!top) return null;
  return {
    state: top.state,
    kind: top.kind,
    app: appOf(records, top.id),
    progress: top.progress,
    msg: top.msg,
    at: top.at,
  };
}
