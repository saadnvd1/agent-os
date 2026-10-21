import { execFile } from "child_process";
import fs from "fs";
import { promisify } from "util";
import { windowsListeners } from "@/lib/windows-ports";
import type { Listener } from "./types";

const execFileAsync = promisify(execFile);

const TTL_MS = 3000;

/** `lsof -F pcn` output: one listener per (pid, port). */
export function parseLsofListeners(out: string): Listener[] {
  const seen = new Set<string>();
  const found: Listener[] = [];
  let pid: number | null = null;
  let command: string | null = null;
  for (const line of out.split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      pid = Number(value) || null;
      command = null;
    } else if (tag === "c") command = value;
    else if (tag === "n") {
      const port = Number(value.slice(value.lastIndexOf(":") + 1));
      if (!Number.isInteger(port) || port <= 0) continue;
      const key = `${pid}:${port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ port, pid, command, cwd: null });
    }
  }
  return found;
}

/** `lsof -a -d cwd -Fpn` output as pid → cwd. */
export function parseLsofCwds(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of out.split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1)) || null;
    else if (line[0] === "n" && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

export async function cwdsOf(pids: number[]): Promise<Map<number, string>> {
  if (!pids.length) return new Map();
  if (process.platform === "linux") {
    const pairs = await Promise.all(
      pids.map(async (pid) => {
        try {
          return [pid, await fs.promises.readlink(`/proc/${pid}/cwd`)] as const;
        } catch {
          return null;
        }
      })
    );
    return new Map(pairs.filter((p) => p !== null));
  }
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-a", "-d", "cwd", "-p", pids.join(","), "-Fpn"],
      { timeout: 5000 }
    );
    return parseLsofCwds(stdout);
  } catch (error) {
    const out = (error as { stdout?: string }).stdout;
    return out ? parseLsofCwds(out) : new Map();
  }
}

async function lsofListeners(): Promise<Listener[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"],
      { timeout: 5000, maxBuffer: 8 << 20 }
    );
    return parseLsofListeners(stdout);
  } catch (error) {
    // lsof exits 1 when nothing listens; a missing lsof can't answer.
    const e = error as { code?: unknown; stdout?: string };
    if (e.code === "ENOENT") return null;
    return parseLsofListeners(e.stdout ?? "");
  }
}

let cache: { at: number; listeners: Listener[] | null } | undefined;

/**
 * Every TCP listener in this machine's namespace with its pid, command and
 * cwd, and Windows' under WSL 2. Null when this machine can't be asked.
 */
export async function listListeners(
  now = Date.now()
): Promise<Listener[] | null> {
  if (cache && now - cache.at < TTL_MS) return cache.listeners;
  const local = await lsofListeners();
  let listeners: Listener[] | null = local;
  if (local) {
    const pids = [
      ...new Set(local.map((l) => l.pid).filter((p) => p !== null)),
    ];
    const cwds = await cwdsOf(pids as number[]);
    listeners = local.map((l) => ({
      ...l,
      cwd: (l.pid && cwds.get(l.pid)) || null,
    }));
  }
  const windows = await windowsListeners();
  if (windows) {
    const have = new Set((listeners ?? []).map((l) => l.port));
    listeners = [
      ...(listeners ?? []),
      ...[...windows]
        .filter(([port]) => !have.has(port))
        .map(([port, pid]) => ({
          port,
          pid,
          command: null,
          cwd: null,
          windows: true,
        })),
    ];
  }
  cache = { at: now, listeners };
  return listeners;
}

export function resetListenersCache() {
  cache = undefined;
}
