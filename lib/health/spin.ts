/**
 * bg-spin: a background job whose shell burns a core with nothing printed is a
 * wait loop that can never exit (`until grep -q "" /dev/null; do :; done`).
 * The pure half: deciding it, picking what to stop, and the words about it.
 * No I/O here; spin-tick.ts reads the processes and stops them.
 *
 * Only the CPU of shells in the job's tree is counted. A loop's work happens
 * in the shell itself (builtins, or children reaped into its total), while a
 * build's lives in node, cc or cargo, so a silent heavy build never reads as
 * spinning.
 */

import path from "path";
import { WAIT_ADVICE } from "../agents/brief";
import type { ProcRow } from "../process-table";
import { MIN } from "./types";

// Share of one core, every interval of the window.
export const SPIN_CORES = 0.8;
// How long it has to hold, with nothing new in the output.
export const SPIN_WINDOW_MS = 4 * MIN;
// Younger jobs aren't sampled.
export const SPIN_MIN_AGE_MS = SPIN_WINDOW_MS;
// A longer gap between samples (missed ticks, a sleeping laptop) starts over.
export const SPIN_MAX_GAP_MS = 3 * MIN;
// SIGTERM, then SIGKILL for whatever is still there.
export const KILL_GRACE_MS = 3000;
// Samples older than this are no use to the decision.
export const SPIN_KEEP_MS = SPIN_WINDOW_MS + 2 * MIN;

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh"]);
const AGENTS = new Set(["claude"]);
// Never part of a job's tree to stop.
const NEVER = new Set(["tmux", "claude"]);

export const baseOf = (comm: string): string =>
  path.basename(comm).replace(/^-/, "");

export interface SpinSample {
  at: number;
  // Cumulative CPU seconds of the tree's shells.
  cpuSec: number;
  // The output file's last write, if it has one.
  outputAt: number | null;
}

export type SpinClass =
  "warming" | "sleeping" | "busy-with-output" | "spinning";

export function classifySpin(samples: SpinSample[]): SpinClass {
  if (samples.length < 2) return "warming";
  // The unbroken run of samples ending now.
  let from = samples.length - 1;
  while (from > 0 && samples[from].at - samples[from - 1].at <= SPIN_MAX_GAP_MS)
    from--;
  const run = samples.slice(from);
  const last = run[run.length - 1];
  // Start at the newest sample at least a window old.
  let start = -1;
  for (let i = 0; i < run.length; i++)
    if (last.at - run[i].at >= SPIN_WINDOW_MS) start = i;
  if (start < 0) return "warming";
  const win = run.slice(start);
  for (let i = 1; i < win.length; i++) {
    const wall = (win[i].at - win[i - 1].at) / 1000;
    const cpu = Math.max(0, win[i].cpuSec - win[i - 1].cpuSec);
    if (wall <= 0 || cpu / wall < SPIN_CORES) return "sleeping";
  }
  const wrote = win.some((s) => s.outputAt !== null && s.outputAt > win[0].at);
  return wrote ? "busy-with-output" : "spinning";
}

// Of the processes holding a task's output file open, the job's root: the
// one whose parent doesn't hold it too.
export function pickRoot(holders: number[], table: ProcRow[]): number | null {
  const held = new Set(holders);
  const roots = table.filter((r) => held.has(r.pid) && !held.has(r.ppid));
  return roots.length === 1 ? roots[0].pid : null;
}

export function jobTree(root: number, table: ProcRow[]): ProcRow[] {
  const kids = new Map<number, ProcRow[]>();
  for (const r of table) {
    const list = kids.get(r.ppid);
    if (list) list.push(r);
    else kids.set(r.ppid, [r]);
  }
  const byPid = new Map(table.map((r) => [r.pid, r]));
  const out: ProcRow[] = [];
  const seen = new Set<number>();
  const stack = [byPid.get(root)].filter((r): r is ProcRow => !!r);
  while (stack.length) {
    const at = stack.shift() as ProcRow;
    if (seen.has(at.pid)) continue;
    seen.add(at.pid);
    out.push(at);
    stack.push(...(kids.get(at.pid) ?? []));
  }
  return out;
}

export const shellPids = (tree: ProcRow[]): number[] =>
  tree.filter((r) => SHELLS.has(baseOf(r.comm))).map((r) => r.pid);

// Whether this tree is a background job of an agent and nothing else: a
// shell directly under the agent, with nothing of AgentOS, tmux or the agent
// inside it.
export function safeToKill(
  root: number,
  table: ProcRow[],
  protectedPids: number[] = [process.pid, process.ppid]
): boolean {
  const head = table.find((r) => r.pid === root);
  if (!head || root <= 1) return false;
  if (!SHELLS.has(baseOf(head.comm))) return false;
  const parent = table.find((r) => r.pid === head.ppid);
  if (!parent || !AGENTS.has(baseOf(parent.comm))) return false;
  return !jobTree(root, table).some(
    (r) =>
      protectedPids.includes(r.pid) ||
      r.pid === parent.pid ||
      NEVER.has(baseOf(r.comm))
  );
}

// The PIDs to signal: the root first, so a loop can't respawn children, then
// everything under it.
export const killPlan = (root: number, table: ProcRow[]): number[] =>
  jobTree(root, table).map((r) => r.pid);

// ps's TIME column: [[D-]H:]M:SS[.cc] to seconds.
export function parseCpuTime(text: string): number | null {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  return (
    Number(m[1] ?? 0) * 86400 +
    Number(m[2] ?? 0) * 3600 +
    Number(m[3]) * 60 +
    Number(m[4])
  );
}

export function spinNote(description: string, pid: number): string {
  const mins = Math.round(SPIN_WINDOW_MS / MIN);
  return `AgentOS stopped your background job "${description}" (PID ${pid}): its shell used about a core for ${mins}+ minutes with no output, which is a wait loop that can't exit. ${WAIT_ADVICE}`;
}

export function spinEventLine(
  sessionName: string,
  description: string,
  pid: number
): string {
  const mins = Math.round(SPIN_WINDOW_MS / MIN);
  return `Stopped background job "${description}" (PID ${pid}) in ${sessionName}: a shell wait loop holding a core for ${mins}+ minutes with no output. The task was told.`;
}
