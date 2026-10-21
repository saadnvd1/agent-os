/**
 * Ports Windows is listening on, seen from inside WSL 2. WSL's localhost
 * forwarding shares ports with Windows, but lsof in the distro can't see a
 * Windows process, so a dev server on Windows :3000 and a session's :3000
 * collide. netstat.exe answers in ~100ms where PowerShell takes seconds to
 * start. Any failure is "unknown": callers fall back to the lsof check and
 * never block on this.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { wslVersion } from "./wsl";

const execFileAsync = promisify(execFile);

const TTL_MS = 3000;

/**
 * Listening ports in `netstat.exe -ano -p TCP` output, each with the pid
 * that holds it. A listener has a wildcard peer (0.0.0.0:0 or [::]:0), which
 * holds in every Windows locale; the state column ("LISTENING") is
 * translated.
 */
export function parseNetstatOwners(out: string): Map<number, number | null> {
  const owners = new Map<number, number | null>();
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[0].toUpperCase() !== "TCP") continue;
    const [, local, peer] = cols;
    if (!/^(0\.0\.0\.0|\[::\]):0$/.test(peer)) continue;
    const port = Number(local.slice(local.lastIndexOf(":") + 1));
    const pid = Number(cols[cols.length - 1]);
    if (Number.isInteger(port) && port > 0 && !owners.has(port))
      owners.set(port, Number.isInteger(pid) && pid > 0 ? pid : null);
  }
  return owners;
}

export const parseNetstatListeners = (out: string): Set<number> =>
  new Set(parseNetstatOwners(out).keys());

type Run = (file: string, args: string[]) => Promise<string>;

const defaultRun: Run = async (file, args) =>
  (await execFileAsync(file, args, { timeout: 4000, maxBuffer: 8 << 20 }))
    .stdout;

type Owners = Map<number, number | null>;

let cache: { at: number; owners: Owners | null } | undefined;
let inflight: Promise<Owners | null> | undefined;

type Opts = { wsl?: number; run?: Run; now?: number };

/** Windows' listening ports and their pids, or null when unknown (not WSL 2, or it failed). */
export async function windowsListeners(
  opts: Opts = {}
): Promise<Owners | null> {
  if ((opts.wsl ?? wslVersion()) !== 2) return null;
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.owners;
  inflight ??= (opts.run ?? defaultRun)("netstat.exe", ["-ano", "-p", "TCP"])
    .then((out) => parseNetstatOwners(out))
    .catch(() => null)
    .then((owners) => {
      cache = { at: now, owners };
      return owners;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

/** The ports Windows listens on, or null when unknown (not WSL 2, or it failed). */
export async function windowsListeningPorts(
  opts: Opts = {}
): Promise<Set<number> | null> {
  const owners = await windowsListeners(opts);
  return owners ? new Set(owners.keys()) : null;
}

export function resetWindowsPortsCache() {
  cache = undefined;
  inflight = undefined;
}
