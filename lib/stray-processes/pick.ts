// Which processes belong to a worktree. Pure: the listing comes in as data.

import path from "path";
import type { Proc } from "./types";

const clean = (p: string) => path.resolve(p.replace(/ \(deleted\)$/, ""));

export const inside = (p: string, root: string) =>
  p === root || p.startsWith(`${root}/`);

// The root named as a whole path in a command line: followed by a slash, a
// space or the end, never a longer folder name that merely starts with it.
export function mentions(command: string, root: string): boolean {
  const esc = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s=:'"])${esc}(?=$|[/\\s'":])`).test(command);
}

export const ownedBy = (p: Proc, root: string): boolean =>
  (p.cwd !== null && inside(clean(p.cwd), root)) || mentions(p.command, root);

// A tmux client or server is never taken, whatever folder it sits in.
const isTmux = (p: Proc) => /^(\S*\/)?tmux(:|\s|$)/.test(p.command);

// The server and everything that leads to it: its ancestors share its fate.
export function protectedPids(
  procs: Proc[],
  serverPids: number[]
): Set<number> {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const out = new Set<number>();
  for (const start of serverPids) {
    let at: number | undefined = start;
    while (at && at > 1 && !out.has(at)) {
      out.add(at);
      at = byPid.get(at)?.ppid;
    }
  }
  return out;
}

export interface PickInput {
  procs: Proc[];
  // Folder of the worktree; null to pick by port alone.
  worktree: string | null;
  // Pids holding the ports the task was given.
  portHolders?: number[];
  // The AgentOS server's own pids (this process, the live record's).
  serverPids: number[];
}

export interface Pick {
  pid: number;
  pgid: number;
  command: string;
  // Whether the whole group may be signalled: false when it also holds the
  // server, one of its ancestors or a tmux.
  group: boolean;
}

export function pickProcesses(input: PickInput): Pick[] {
  const root = input.worktree ? clean(input.worktree) : null;
  const guard = protectedPids(input.procs, input.serverPids);
  const guardGroups = new Set(
    input.procs.filter((p) => guard.has(p.pid)).map((p) => p.pgid)
  );
  const holders = new Set(input.portHolders ?? []);
  const chosen = input.procs.filter(
    (p) =>
      p.pid > 1 &&
      !guard.has(p.pid) &&
      !isTmux(p) &&
      ((root !== null && ownedBy(p, root)) || holders.has(p.pid))
  );
  return chosen.map((p) => ({
    pid: p.pid,
    pgid: p.pgid,
    command: p.command,
    group:
      p.pgid > 1 &&
      !guardGroups.has(p.pgid) &&
      !input.procs.some((q) => q.pgid === p.pgid && isTmux(q)),
  }));
}
