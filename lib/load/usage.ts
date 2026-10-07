// What each session's processes use: one `ps` for the whole machine and one
// `tmux list-panes`, then each pane's process tree summed. Never a call per
// session.
import { execFile } from "child_process";

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

// Each key's panes and everything under them. A process is counted once,
// for the first key that reaches it.
export function sumTrees(
  procs: Proc[],
  roots: { key: string; pid: number }[]
): Record<string, Usage> {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const children = new Map<number, number[]>();
  for (const p of procs) {
    const list = children.get(p.ppid);
    if (list) list.push(p.pid);
    else children.set(p.ppid, [p.pid]);
  }
  const seen = new Set<number>();
  const out: Record<string, Usage> = {};
  for (const { key, pid } of roots) {
    const usage = (out[key] ??= { cores: 0, rssBytes: 0 });
    const stack = [pid];
    while (stack.length) {
      const at = stack.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      const p = byPid.get(at);
      if (p) {
        usage.cores += p.pcpu / 100;
        usage.rssBytes += p.rss * 1024;
      }
      stack.push(...(children.get(at) ?? []));
    }
  }
  return out;
}

const run = (cmd: string, args: string[], timeout: number) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, stdout) =>
      resolve(err ? "" : stdout)
    )
  );

// Usage by tmux session name. Empty when ps or tmux can't be read.
export async function readUsage(
  timeoutMs = 3000
): Promise<Record<string, Usage>> {
  const [ps, panes] = await Promise.all([
    run("ps", ["-Ao", "pid=,ppid=,pcpu=,rss="], timeoutMs),
    run(
      "tmux",
      ["list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}"],
      timeoutMs
    ),
  ]);
  return sumTrees(
    parsePs(ps),
    parsePanes(panes).map((p) => ({ key: p.tmux, pid: p.pid }))
  );
}
