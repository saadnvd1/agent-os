// The machine's processes as data. Only this file touches ps, /proc and lsof.

import fs from "fs";
import { probe } from "../dev-instance/processInfo";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Proc } from "./types";

const run = promisify(execFile);
const BIG = { encoding: "utf8" as const, timeout: 10_000, maxBuffer: 32 << 20 };

async function cwds(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (process.platform === "linux") {
    for (const name of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        out.set(Number(name), fs.readlinkSync(`/proc/${name}/cwd`));
      } catch {
        // Not ours to read, or gone.
      }
    }
    return out;
  }
  const { stdout } = await run("lsof", ["-a", "-d", "cwd", "-Fpn"], BIG).catch(
    (e: { stdout?: string }) => ({ stdout: e.stdout ?? "" })
  );
  let pid = 0;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) out.set(pid, line.slice(1));
  }
  return out;
}

export async function listProcesses(): Promise<Proc[]> {
  const [ps, cwd] = await Promise.all([
    run("ps", ["-axo", "pid=,ppid=,pgid=,command="], BIG),
    cwds(),
  ]);
  const procs: Proc[] = [];
  for (const line of ps.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    procs.push({
      pid,
      ppid: Number(m[2]),
      pgid: Number(m[3]),
      cwd: cwd.get(pid) ?? null,
      command: m[4],
    });
  }
  return procs;
}

// Who listens on a port, by pid.
export async function portHolders(ports: number[]): Promise<number[]> {
  const pids = new Set<number>();
  for (const port of ports) {
    const out = await probe("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]).catch(() => "");
    for (const l of out.split("\n"))
      if (/^\d+$/.test(l.trim())) pids.add(Number(l));
  }
  return [...pids];
}
