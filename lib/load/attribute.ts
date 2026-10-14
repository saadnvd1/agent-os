// Who is using the machine: every process goes to the session whose tree it
// is in, or, for a heavy one that left its tree (a build daemon reparented to
// init), to the session whose worktree it runs in. What's left is grouped by
// name so the orchestrator can tell its tasks from everything else.
import { execFile } from "child_process";
import { existsSync } from "fs";
import { readlink } from "fs/promises";
import path from "path";
import type { ProcRow } from "../process-table";
import { workerTmuxName } from "../chat/worker/protocol";
import { claimTrees, type Usage } from "./usage";

// A row shows its usage, and a group is listed, from here up.
export const BUSY_CORES = 0.5;
const HOT_PCPU = 20;
const MAX_LOOKUPS = 40;
const MAX_HOT = 20;
const MAX_GROUPS = 3;
const BIG_RSS = 2 ** 30;

export interface SessionLoad extends Usage {
  sessionId: string;
  name: string;
  heavy: string[];
}

export interface ProcGroup {
  name: string;
  count: number;
  cores: number;
  rssBytes: number;
}

export interface SessionRow {
  id: string;
  name: string;
  tmux_name: string;
  worktree_path: string | null;
  working_directory: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const baseName = (comm: string) =>
  comm.split("/").pop()?.replace(/^-/, "") || comm;

// Each session's own tmux session, plus its chat worker's.
export function claimSessions(
  procs: ProcRow[],
  panes: { tmux: string; pid: number }[],
  rows: SessionRow[]
): Map<number, string> {
  const roots: { key: string; pid: number }[] = [];
  for (const row of rows)
    for (const p of panes)
      if (p.tmux === row.tmux_name || p.tmux === workerTmuxName(row.id))
        roots.push({ key: row.id, pid: p.pid });
  return claimTrees(procs, roots);
}

// The directories a process's cwd can place it by, longest first. The
// worktree when there is one; otherwise the working directory, but only when
// it is specific to the session.
export function sessionPaths(
  rows: SessionRow[],
  home: string
): { sessionId: string; path: string }[] {
  const count = new Map<string, number>();
  for (const r of rows)
    count.set(r.working_directory, (count.get(r.working_directory) ?? 0) + 1);
  const out: { sessionId: string; path: string }[] = [];
  for (const r of rows) {
    let dir = r.worktree_path;
    if (!dir) {
      dir = r.working_directory.replace(/^~(?=$|\/)/, home);
      if (
        !path.isAbsolute(dir) ||
        dir === "/" ||
        dir === home ||
        count.get(r.working_directory)! > 1
      )
        continue;
    }
    out.push({ sessionId: r.id, path: dir.replace(/\/+$/, "") });
  }
  return out.sort((a, b) => b.path.length - a.path.length);
}

export function matchSession(
  cwd: string,
  paths: { sessionId: string; path: string }[]
): string | null {
  const hit = paths.find((p) => cwd === p.path || cwd.startsWith(p.path + "/"));
  return hit?.sessionId ?? null;
}

// The heavy processes no session owns, and their unowned ancestors (the
// daemon that spawned the workers), whose cwd is worth looking up.
export function cwdCandidates(
  procs: ProcRow[],
  owner: Map<number, string>
): number[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const hot = procs
    .filter((p) => !owner.has(p.pid) && p.pcpu >= HOT_PCPU)
    .sort((a, b) => b.pcpu - a.pcpu)
    .slice(0, MAX_HOT);
  const out = new Set<number>();
  for (const p of hot) {
    let at: ProcRow | undefined = p;
    while (at && at.pid > 1 && !owner.has(at.pid) && out.size < MAX_LOOKUPS) {
      out.add(at.pid);
      at = byPid.get(at.ppid);
    }
  }
  return [...out];
}

// `lsof -a -d cwd -Fpn`: a `p<pid>` line, then `n<path>` for its cwd.
export function parseLsofCwd(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1)) || 0;
    else if (line.startsWith("n") && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

const LSOF = ["/usr/sbin/lsof", "/usr/bin/lsof"].find((p) => existsSync(p));

export async function readCwds(pids: number[]): Promise<Map<number, string>> {
  const cwds = new Map<number, string>();
  if (!pids.length) return cwds;
  if (process.platform === "linux") {
    await Promise.all(
      pids.map((pid) =>
        readlink(`/proc/${pid}/cwd`).then(
          (dir) => void cwds.set(pid, dir),
          () => undefined
        )
      )
    );
    return cwds;
  }
  return new Promise((resolve) =>
    execFile(
      LSOF ?? "lsof",
      ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")],
      { timeout: 2000, maxBuffer: 1 << 20 },
      // lsof exits 1 when some pids are gone but still prints the rest.
      (_err, stdout) => resolve(parseLsofCwd(stdout ?? ""))
    )
  );
}

export function attributeLoad(input: {
  procs: ProcRow[];
  owner: Map<number, string>;
  rows: SessionRow[];
  cwds: Map<number, string>;
  home: string;
}): { sessions: Record<string, SessionLoad>; unattributed: ProcGroup[] } {
  const { procs, owner, rows, cwds, home } = input;
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const paths = sessionPaths(rows, home);
  // Memoised: the session an unowned process belongs to, by its own cwd or
  // its nearest unowned ancestor's.
  const placed = new Map<number, string | null>();
  const place = (p: ProcRow, depth = 0): string | null => {
    if (placed.has(p.pid)) return placed.get(p.pid)!;
    const cwd = cwds.get(p.pid);
    let id = cwd ? matchSession(cwd, paths) : null;
    const parent = byPid.get(p.ppid);
    if (!id && parent && parent.pid > 1 && depth < 64 && !owner.has(parent.pid))
      id = place(parent, depth + 1);
    placed.set(p.pid, id);
    return id;
  };

  const raw = new Map<string, Usage>();
  const groups = new Map<string, ProcGroup>();
  for (const p of procs) {
    const id = owner.get(p.pid) ?? place(p);
    if (id) {
      const u = raw.get(id) ?? { cores: 0, rssBytes: 0 };
      u.cores += p.pcpu / 100;
      u.rssBytes += p.rss * 1024;
      raw.set(id, u);
      continue;
    }
    const name = baseName(p.comm);
    const g = groups.get(name) ?? { name, count: 0, cores: 0, rssBytes: 0 };
    g.count++;
    g.cores += p.pcpu / 100;
    g.rssBytes += p.rss * 1024;
    groups.set(name, g);
  }

  const sessions: Record<string, SessionLoad> = {};
  for (const row of rows) {
    const u = raw.get(row.id);
    if (!u) continue;
    sessions[row.id] = {
      sessionId: row.id,
      name: row.name,
      cores: round1(u.cores),
      rssBytes: u.rssBytes,
      heavy: [],
    };
  }
  const unattributed = [...groups.values()]
    .filter((g) => g.cores >= BUSY_CORES || g.rssBytes >= BIG_RSS)
    .sort((a, b) => b.cores - a.cores)
    .slice(0, MAX_GROUPS)
    .map((g) => ({ ...g, cores: round1(g.cores) }));
  return { sessions, unattributed };
}
