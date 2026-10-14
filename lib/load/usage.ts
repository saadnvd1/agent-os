// What each session's processes use: one `ps` for the whole machine and one
// `tmux list-panes`, then each pane's process tree walked. Never a call per
// session.
import { execFile } from "child_process";
import type { ProcRow } from "../process-table";

export interface Proc {
  pid: number;
  ppid: number;
  // ps's %CPU: 100 is one core.
  pcpu: number;
  // Kilobytes.
  rss: number;
}

export interface Usage {
  cores: number;
  rssBytes: number;
}

// `ps -Ao pid=,ppid=,pcpu=,rss=`: four numbers a line.
export function parsePs(out: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of out.split("\n")) {
    const [pid, ppid, pcpu, rss] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid) && pid > 0)
      procs.push({ pid, ppid, pcpu: pcpu || 0, rss: rss || 0 });
  }
  return procs;
}

// `tmux list-panes -a -F '#{session_name}\t#{pane_pid}'`.
export function parsePanes(out: string): { tmux: string; pid: number }[] {
  return out
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([name, pid]) => name && Number(pid) > 0)
    .map(([tmux, pid]) => ({ tmux, pid: Number(pid) }));
}

// The key that owns each process: its panes and everything under them. A
// process goes to the first key that reaches it.
export function claimTrees(
  procs: Proc[],
  roots: { key: string; pid: number }[]
): Map<number, string> {
  const children = new Map<number, number[]>();
  for (const p of procs) {
    const list = children.get(p.ppid);
    if (list) list.push(p.pid);
    else children.set(p.ppid, [p.pid]);
  }
  const owner = new Map<number, string>();
  for (const { key, pid } of roots) {
    const stack = [pid];
    while (stack.length) {
      const at = stack.pop()!;
      if (owner.has(at)) continue;
      owner.set(at, key);
      stack.push(...(children.get(at) ?? []));
    }
  }
  return owner;
}

// Each key's panes and everything under them, summed.
export function sumTrees(
  procs: Proc[],
  roots: { key: string; pid: number }[]
): Record<string, Usage> {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const out: Record<string, Usage> = {};
  for (const { key } of roots) out[key] ??= { cores: 0, rssBytes: 0 };
  for (const [pid, key] of claimTrees(procs, roots)) {
    const p = byPid.get(pid);
    if (!p) continue;
    out[key].cores += p.pcpu / 100;
    out[key].rssBytes += p.rss * 1024;
  }
  return out;
}

const run = (cmd: string, args: string[], timeout: number) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, stdout) =>
      resolve(err ? "" : stdout)
    )
  );

// The process table and the tmux panes, for attributing load to sessions.
// Empty when ps or tmux can't be read. The table is the one shared with the
// rest of the server.
export async function readSnapshot(timeoutMs = 3000): Promise<{
  procs: ProcRow[];
  panes: { tmux: string; pid: number }[];
}> {
  const { processTable } = await import("../process-table");
  const [procs, panes] = await Promise.all([
    processTable(),
    run(
      "tmux",
      ["list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}"],
      timeoutMs
    ),
  ]);
  return { procs: procs ?? [], panes: parsePanes(panes) };
}
