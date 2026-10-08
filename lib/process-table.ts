import { execFile } from "child_process";
import { existsSync } from "fs";
import { parsePs, type Proc } from "./load/usage";

/**
 * The machine's process table, one `ps` shared by whoever asks within a
 * couple of seconds: whether a session's agent still runs (lib/tasks) and
 * what each session uses (lib/load). Nothing polls it; a failed read backs
 * off instead of being retried at once.
 */

export interface ProcRow extends Proc {
  // The executable's name, as ps gives it (a full path on macOS).
  comm: string;
}

// Resolved once: a bare name walks every PATH entry on each spawn.
const PS = ["/bin/ps", "/usr/bin/ps"].find((p) => existsSync(p)) ?? "ps";
const MAX_BACKOFF_MS = 60_000;

let cached: { at: number; rows: ProcRow[] } | null = null;
let reading: Promise<ProcRow[] | null> | null = null;
let failures = 0;
let retryAt = 0;

// `ps -Ao pid=,ppid=,pcpu=,rss=,comm=`: comm is last and may hold spaces.
export function parsePsTable(out: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [proc] = parsePs(`${m[1]} ${m[2]} ${m[3]} ${m[4]}`);
    if (proc) rows.push({ ...proc, comm: m[5].trim() });
  }
  return rows;
}

function read(): Promise<ProcRow[] | null> {
  return new Promise((resolve) =>
    execFile(
      PS,
      ["-Ao", "pid=,ppid=,pcpu=,rss=,comm="],
      { timeout: 3000, maxBuffer: 8 << 20 },
      (err, stdout) => {
        const rows = err ? [] : parsePsTable(stdout);
        // An empty or failed table isn't an answer: it would read as every
        // agent gone.
        resolve(rows.length ? rows : null);
      }
    )
  );
}

/** The table, at most `maxAgeMs` old; null when ps can't be read. */
export async function processTable(maxAgeMs = 2000): Promise<ProcRow[] | null> {
  const now = Date.now();
  if (cached && now - cached.at < maxAgeMs) return cached.rows;
  if (now < retryAt) return null;
  reading ??= read().then((rows) => {
    reading = null;
    if (rows) {
      cached = { at: Date.now(), rows };
      failures = 0;
    } else {
      failures++;
      retryAt = Date.now() + Math.min(1000 * 2 ** failures, MAX_BACKOFF_MS);
    }
    return rows;
  });
  return reading;
}

const base = (comm: string) => comm.split("/").pop()?.replace(/^-/, "") ?? "";

/**
 * Whether something the user started runs under `pid` (a pane's shell). A
 * prompt theme's background copy of the shell, with nothing under it, isn't.
 */
export function runsSomething(rows: ProcRow[], pid: number): boolean {
  const shell = rows.find((r) => r.pid === pid);
  // A pane the table doesn't know (newer than the table, or gone since) says
  // nothing about its agent: it counts as still running.
  if (!shell) return true;
  const children = new Map<number, ProcRow[]>();
  for (const r of rows) {
    const list = children.get(r.ppid);
    if (list) list.push(r);
    else children.set(r.ppid, [r]);
  }
  return (children.get(pid) ?? []).some(
    (child) =>
      base(child.comm) !== base(shell.comm) ||
      (children.get(child.pid)?.length ?? 0) > 0
  );
}

// For tests.
export function resetProcessTable(): void {
  cached = null;
  reading = null;
  failures = 0;
  retryAt = 0;
}
