// Stops what a task started and left running: SIGTERM to the process group,
// SIGKILL after a short grace. Never the AgentOS server, its ancestors or tmux.

import { readLiveRecord } from "../dev-instance/liveServer";
import { pidAlive } from "../dev-instance/processInfo";
import { listProcesses, portHolders } from "./list";
import { pickProcesses, type Pick } from "./pick";
import type { Proc, Stopped } from "./types";

export interface StopDeps {
  list: () => Promise<Proc[]>;
  holders: (ports: number[]) => Promise<number[]>;
  serverPids: () => number[];
  kill: (pid: number, signal: NodeJS.Signals) => void;
  alive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  graceMs: number;
}

export const realDeps: StopDeps = {
  list: listProcesses,
  holders: portHolders,
  serverPids: () => [process.pid, readLiveRecord()?.pid ?? 0].filter(Boolean),
  kill: (pid, signal) => process.kill(pid, signal),
  alive: pidAlive,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  graceMs: 3000,
};

function send(d: StopDeps, p: Pick, signal: NodeJS.Signals) {
  try {
    d.kill(p.group ? -p.pgid : p.pid, signal);
  } catch {
    try {
      d.kill(p.pid, signal);
    } catch {
      // Already gone.
    }
  }
}

// Signals the picked processes and waits for them; returns what was stopped.
export async function terminate(
  picks: Pick[],
  d: StopDeps = realDeps
): Promise<Stopped[]> {
  if (!picks.length) return [];
  for (const p of picks) send(d, p, "SIGTERM");
  const until = Date.now() + d.graceMs;
  while (Date.now() < until && picks.some((p) => d.alive(p.pid)))
    await d.sleep(100);
  for (const p of picks) if (d.alive(p.pid)) send(d, p, "SIGKILL");
  return picks.map((p) => ({ pid: p.pid, command: p.command.slice(0, 120) }));
}

export async function stopWorktreeProcesses(
  worktree: string | null,
  ports: number[] = [],
  deps: Partial<StopDeps> = {}
): Promise<Stopped[]> {
  const d = { ...realDeps, ...deps };
  const [procs, portHolders] = await Promise.all([
    d.list(),
    ports.length ? d.holders(ports) : Promise.resolve([]),
  ]);
  const picks = pickProcesses({
    procs,
    worktree,
    portHolders,
    serverPids: d.serverPids(),
  });
  return terminate(picks, d);
}
