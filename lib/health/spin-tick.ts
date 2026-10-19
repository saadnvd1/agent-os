/**
 * The I/O half of bg-spin (spin.ts decides): once a minute, for each old
 * enough background job of a live chat, find its process tree, sample the CPU
 * of its shells, and stop a job that spins. A stop is by PID, the job's own
 * tree only: SIGTERM, then SIGKILL for what is still the same process after a
 * grace. Never a pattern, never a group, never AgentOS, tmux or the agent.
 * With no old background job there is no process I/O at all.
 */

import { execFile } from "child_process";
import fs from "fs";
import { sendMessage } from "../bus";
import { findOutputFile } from "../chat/task-output";
import { queueEventOnce } from "../orchestrator/events";
import { untrusted } from "../orchestrator/untrusted";
import { processTable, type ProcRow } from "../process-table";
import { runningBgTasks, type BgTask } from "./facts";
import { close, recordTrips } from "./store";
import {
  KILL_GRACE_MS,
  SPIN_KEEP_MS,
  SPIN_MIN_AGE_MS,
  baseOf,
  classifySpin,
  jobTree,
  killPlan,
  parseCpuTime,
  pickRoot,
  safeToKill,
  shellPids,
  spinEventLine,
  spinNote,
  type SpinSample,
} from "./spin";
import type { Trip } from "./types";

export interface SpinDeps {
  tasks: (now: number) => BgTask[];
  // Output file -> the PIDs holding it open.
  holders: (files: string[]) => Promise<Map<string, number[]>>;
  table: () => Promise<ProcRow[] | null>;
  cpuSeconds: (pids: number[]) => Promise<Map<number, number>>;
  kill: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  sleep: (ms: number) => Promise<void>;
  tell: (sessionId: string, body: string) => Promise<void>;
  event: (
    workspaceId: string,
    key: string,
    subject: string,
    line: string,
    now: number
  ) => void;
  record: (trip: Trip, now: number) => void;
}

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout: 5000, maxBuffer: 4 << 20 }, (_err, out) =>
      resolve(out ?? "")
    )
  );

// `lsof -F pn`: a `p<pid>` line, then `n<name>` for each file it holds.
export function parseHolders(out: string): Map<string, number[]> {
  const map = new Map<string, number[]>();
  let pid = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1)) || 0;
    else if (line.startsWith("n") && pid) {
      const list = map.get(line.slice(1)) ?? [];
      if (!list.includes(pid)) list.push(pid);
      map.set(line.slice(1), list);
    }
  }
  return map;
}

// Linux counts reaped children in /proc; macOS ps's TIME already includes them.
function procCpu(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return (
      (Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14])) / 100
    );
  } catch {
    return null;
  }
}

async function cpuSeconds(pids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!pids.length) return out;
  if (process.platform === "linux") {
    for (const pid of pids) {
      const sec = procCpu(pid);
      if (sec !== null) out.set(pid, sec);
    }
    return out;
  }
  const text = await run("ps", ["-o", "pid=,time=", "-p", pids.join(",")]);
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(line);
    const sec = m ? parseCpuTime(m[2]) : null;
    if (m && sec !== null) out.set(Number(m[1]), sec);
  }
  return out;
}

export const realSpin: SpinDeps = {
  tasks: (now) =>
    runningBgTasks(now, SPIN_MIN_AGE_MS).map((t) => ({
      ...t,
      outputFile: t.outputFile ?? findOutputFile(t.taskId) ?? undefined,
    })),
  holders: async (files) =>
    parseHolders(await run("lsof", ["-F", "pn", "--", ...files])),
  table: () => processTable(0),
  cpuSeconds,
  kill: (pid, signal) => process.kill(pid, signal),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  tell: async (sessionId, body) => {
    await sendMessage({
      fromId: null,
      to: sessionId,
      body,
      fromLabel: "AgentOS health",
      origin: { kind: "system", label: "Health", body },
    });
  },
  event: (ws, key, subject, line, now) => {
    queueEventOnce(ws, key, subject, line, now);
  },
  record: (trip, now) => {
    const { opened } = recordTrips([trip], [], now);
    // History only: nothing to wake a watcher for.
    for (const row of opened) close(row.id, "stopped", now);
  },
};

interface Track {
  root: number;
  comm: string;
  samples: SpinSample[];
}

const tracks = new Map<string, Track>();
let running = false;

export function resetSpin(): void {
  tracks.clear();
  running = false;
}

const keyOf = (t: BgTask) => `${t.sessionId}:${t.taskId}`;

// SIGTERM the whole job, root first; SIGKILL what is still the same process.
async function stopTree(
  root: number,
  table: ProcRow[],
  deps: SpinDeps
): Promise<number[]> {
  const plan = killPlan(root, table);
  const comm = new Map(table.map((r) => [r.pid, r.comm]));
  const signal = (pid: number, sig: "SIGTERM" | "SIGKILL") => {
    try {
      deps.kill(pid, sig);
    } catch {
      // Already gone.
    }
  };
  for (const pid of plan) signal(pid, "SIGTERM");
  await deps.sleep(KILL_GRACE_MS);
  const after = new Map((await deps.table())?.map((r) => [r.pid, r.comm]));
  for (const pid of plan)
    if (after.has(pid) && after.get(pid) === comm.get(pid))
      signal(pid, "SIGKILL");
  return plan;
}

async function sampleAll(
  jobs: BgTask[],
  now: number,
  deps: SpinDeps
): Promise<{ job: BgTask; track: Track; table: ProcRow[] }[]> {
  const table = await deps.table();
  if (!table) return [];
  const need = jobs.filter((j) => !tracks.get(keyOf(j)) && j.outputFile);
  if (need.length) {
    const held = await deps.holders(need.map((j) => j.outputFile as string));
    for (const j of need) {
      const root = pickRoot(held.get(j.outputFile as string) ?? [], table);
      const row = table.find((r) => r.pid === root);
      if (row)
        tracks.set(keyOf(j), { root: row.pid, comm: row.comm, samples: [] });
    }
  }
  const live: { job: BgTask; track: Track; table: ProcRow[] }[] = [];
  for (const j of jobs) {
    const track = tracks.get(keyOf(j));
    if (!track) continue;
    const row = table.find((r) => r.pid === track.root);
    // Gone, or the PID is someone else's now.
    if (!row || row.comm !== track.comm) {
      tracks.delete(keyOf(j));
      continue;
    }
    live.push({ job: j, track, table });
  }
  const pids = live.flatMap((l) => shellPids(jobTree(l.track.root, table)));
  const cpu = await deps.cpuSeconds(pids);
  for (const { job, track } of live) {
    const sec = shellPids(jobTree(track.root, table)).reduce(
      (sum, pid) => sum + (cpu.get(pid) ?? 0),
      0
    );
    track.samples.push({ at: now, cpuSec: sec, outputAt: job.outputAt });
    track.samples = track.samples.filter((s) => now - s.at <= SPIN_KEEP_MS);
  }
  return live;
}

export async function spinTick(
  now = Date.now(),
  deps: SpinDeps = realSpin
): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Shell jobs only: a subagent task has no shell to spin.
    const jobs = deps
      .tasks(now)
      .filter((t) => !t.taskType || t.taskType === "local_bash");
    const names = new Set(jobs.map(keyOf));
    for (const k of tracks.keys()) if (!names.has(k)) tracks.delete(k);
    if (!jobs.length) return;
    for (const { job, track, table } of await sampleAll(jobs, now, deps)) {
      if (classifySpin(track.samples) !== "spinning") continue;
      if (!safeToKill(track.root, table)) {
        console.warn(
          `[health] bg-spin: not stopping pid ${track.root} (${baseOf(track.comm)}) in ${job.sessionName}: it is not a plain job of the agent`
        );
        continue;
      }
      const pids = await stopTree(track.root, table, deps);
      tracks.delete(keyOf(job));
      console.warn(
        `[health] bg-spin: stopped "${job.description}" in ${job.sessionName} (session ${job.sessionId}): pid ${track.root}, tree ${pids.join(",")}`
      );
      await announce(job, track.root, now, deps);
    }
  } finally {
    running = false;
  }
}

async function announce(
  job: BgTask,
  pid: number,
  now: number,
  deps: SpinDeps
): Promise<void> {
  const line = spinEventLine(job.sessionName, job.description, pid);
  try {
    deps.record(
      {
        check: "bg-spin",
        subject: keyOf(job),
        severity: "high",
        line,
        detail: { sessionId: job.sessionId, taskId: job.taskId, pid },
        workspaceId: job.workspaceId,
      },
      now
    );
  } catch (error) {
    console.error("[health] bg-spin record:", error);
  }
  if (job.workspaceId)
    deps.event(
      job.workspaceId,
      `bg-spin:${keyOf(job)}`,
      job.sessionId,
      // The description is the agent's own text.
      `Health (tasks): ${untrusted("health detector", line)}`,
      now
    );
  try {
    await deps.tell(job.sessionId, spinNote(job.description, pid));
  } catch (error) {
    console.error("[health] bg-spin note:", error);
  }
}
