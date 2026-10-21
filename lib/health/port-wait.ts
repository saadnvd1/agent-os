/**
 * port-wait, the deciding half (port-wait-tick.ts does the I/O): a shell
 * loop that waits on a port someone else holds can't end, since that holder
 * won't free it for the agent. Sleeping loops use no CPU, so bg-spin never
 * sees them; this names the holder and the way out instead.
 */

import { claimTrees } from "../load/usage";
import { MIN } from "./types";

export const PORT_WAIT_MIN_MS = 10 * MIN;

const LOOP =
  /\b(?:until|while)\b[\s\S]*?\b(?:curl|wget|nc|lsof|ss|netstat|http)\b|\bwait-on\b|\bwait-port\b/;
const PORT_REFS = [
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b/g,
  /\btcp:(\d{2,5})\b/g,
  /\s-i\s*:(\d{2,5})\b/g,
  /\b[sd]port\s*=\s*:(\d{2,5})\b/g,
  /\bnc\s+(?:-\w+\s+)*\S+\s+(\d{2,5})\b/g,
];

// The ports a command waits on, when it is a wait loop at all.
export function waitedPorts(args: string): number[] {
  if (!LOOP.test(args)) return [];
  const ports = new Set<number>();
  for (const re of PORT_REFS)
    for (const m of args.matchAll(re)) {
      const p = Number(m[1]);
      if (p > 0 && p <= 65535) ports.add(p);
    }
  return [...ports];
}

// ps's etime, `[[dd-]hh:]mm:ss`, in seconds.
export function parseEtime(s: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());
  if (!m) return null;
  const [, d, h, mm, ss] = m;
  return (
    ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(mm)) * 60 + Number(ss)
  );
}

export interface ArgsProc {
  pid: number;
  ppid: number;
  ageMs: number;
  args: string;
}

// `ps -Ao pid=,ppid=,etime=,args=`: args is last and holds spaces.
export function parsePsArgs(out: string): ArgsProc[] {
  const rows: ArgsProc[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const age = parseEtime(m[3]);
    if (age === null) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      ageMs: age * 1000,
      args: m[4],
    });
  }
  return rows;
}

export interface WaitSession {
  id: string;
  name: string;
  workspaceId: string | null;
  tmuxName: string | null;
  worktree: string | null;
}

export interface PortWait {
  sessionId: string;
  sessionName: string;
  workspaceId: string | null;
  pid: number;
  port: number;
  args: string;
  waitedMs: number;
}

const inside = (cwd: string, dir: string) =>
  cwd === dir || cwd.startsWith(`${dir.replace(/\/$/, "")}/`);

/**
 * Each session's waits on a port for at least `minMs`, one per session and
 * port (a loop's wrapper shells are folded into its oldest). A process is
 * the session's when it runs in its worktree, or under its tmux pane.
 */
export function findPortWaits(
  procs: ArgsProc[],
  sessions: WaitSession[],
  panes: { tmux: string; pid: number }[],
  cwds: Map<number, string>,
  minMs: number
): PortWait[] {
  const byTmux = new Map(
    sessions.filter((s) => s.tmuxName).map((s) => [s.tmuxName!, s])
  );
  const roots = panes
    .filter((p) => byTmux.has(p.tmux))
    .map((p) => ({ key: byTmux.get(p.tmux)!.id, pid: p.pid }));
  const owner = claimTrees(
    procs.map((p) => ({ pid: p.pid, ppid: p.ppid, pcpu: 0, rss: 0 })),
    roots
  );
  const out = new Map<string, PortWait>();
  for (const p of procs) {
    if (p.ageMs < minMs) continue;
    const ports = waitedPorts(p.args);
    if (!ports.length) continue;
    const cwd = cwds.get(p.pid);
    const s =
      (cwd && sessions.find((x) => x.worktree && inside(cwd, x.worktree))) ||
      sessions.find((x) => x.id === owner.get(p.pid));
    if (!s) continue;
    for (const port of ports) {
      const key = `${s.id}:${port}`;
      const had = out.get(key);
      if (had && had.waitedMs >= p.ageMs) continue;
      out.set(key, {
        sessionId: s.id,
        sessionName: s.name,
        workspaceId: s.workspaceId,
        pid: p.pid,
        port,
        args: p.args,
        waitedMs: p.ageMs,
      });
    }
  }
  return [...out.values()];
}

const short = (args: string) =>
  args.length > 120 ? `${args.slice(0, 117)}...` : args;

export function portWaitNote(
  w: PortWait,
  holder: string,
  own: Record<string, number> | null
): string {
  const mins = Math.round(w.waitedMs / MIN);
  const mine =
    own && Object.keys(own).length
      ? ` Your ports are ${Object.entries(own)
          .map(([n, p]) => `${n}=${p}`)
          .join(", ")}.`
      : "";
  return `You've waited ${mins} min for port ${w.port} (pid ${w.pid}: \`${short(w.args)}\`). It's held by ${holder}, which isn't yours and won't free it for you, so that wait can't end. Stop it (\`kill ${w.pid}\`, your own job), don't stop the holder, and run \`aos port ${w.port}\` for a free port of your own to start on.${mine} If you need ${w.port} itself, tell the orchestrator.`;
}

export const portWaitLine = (w: PortWait, holder: string) =>
  `${w.sessionName} has waited ${Math.round(w.waitedMs / MIN)} min for port ${w.port}, held by ${holder}. It was told to move to its own port.`;
