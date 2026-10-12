/**
 * Keeps `cloudflared tunnel run` going while Connect is on. Each start asks
 * the Connect service for a fresh connector token, which goes to the child
 * in TUNNEL_TOKEN only: never argv, never a file, never a log line. The
 * child exits → it's started again with backoff; stop() ends it.
 *
 * cloudflared must never outlive AgentOS: it would go on publishing
 * whatever next holds the tunnel port. So it runs in a process group of its
 * own under a small shell that kills it the moment AgentOS goes, however it
 * goes (SIGKILL and out-of-memory included), and a copy a crash left behind
 * anyway is killed before the next one starts.
 */

import {
  execFile,
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import type { Readable, Writable } from "stream";
import { ApiError, clean } from "./control-api";

export type TunnelState = "connecting" | "up" | "denied" | "error" | "stopped";

export interface Prepared {
  bin: string;
  token: string;
}

interface Child {
  pid?: number;
  stdin?: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", fn: (code: number | null) => void): unknown;
  on(event: "error", fn: (err: Error) => void): unknown;
}

export type Spawn = (
  bin: string,
  args: string[],
  opts: { env: Record<string, string>; stdio: ["ignore", "pipe", "pipe"] }
) => Child;

export interface SuperviseOptions {
  /** Finds the binary and fetches a fresh token; throws to retry later. */
  prepare: () => Promise<Prepared>;
  /** The Connect folder: cloudflared's config, home and pid file live here. */
  dir: string;
  log?: (line: string) => void;
  spawn?: Spawn;
  delays?: { min: number; max: number; setupMax: number; denied: number };
}

const DELAYS = {
  min: 1000,
  max: 60_000,
  setupMax: 5 * 60_000,
  denied: 5 * 60_000,
};
// cloudflared can be chatty while the network flaps.
const LOG_LINES_PER_MINUTE = 20;

// $1 is cloudflared, the rest its arguments. Its stdin is a pipe only
// AgentOS holds the other end of: when AgentOS ends, the read sees EOF and
// cloudflared is killed outright (a SIGTERM would let it drain, still
// forwarding, for half a minute). The shell exits with cloudflared's code.
const WATCHDOG = `exec 3<&0 </dev/null
"$@" 3<&- &
child=$!
trap 'kill -TERM "$child" 2>/dev/null' TERM INT HUP
{ read -r _ <&3; kill -KILL "$child" 2>/dev/null; } &
watch=$!
exec 3<&-
while :; do
  wait "$child"; code=$?
  kill -0 "$child" 2>/dev/null || break
done
kill "$watch" 2>/dev/null
exit "$code"`;

/** cloudflared under the watchdog, its group killed as one. */
export const spawnTunnel: Spawn = (bin, args, opts) => {
  if (process.platform === "win32")
    return (nodeSpawn as unknown as Spawn)(bin, args, opts);
  const proc: ChildProcess = nodeSpawn(
    "/bin/sh",
    ["-c", WATCHDOG, "agentos-cloudflared", bin, ...args],
    {
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    } as SpawnOptions
  );
  proc.stdin?.on("error", () => {});
  return Object.assign(proc, {
    kill: (signal: NodeJS.Signals = "SIGTERM") => {
      try {
        if (proc.pid) return process.kill(-proc.pid, signal);
      } catch {}
      return proc.kill(signal);
    },
  }) as unknown as Child;
};

const commandOf = (pid: number) =>
  new Promise<string>((resolve) =>
    execFile(
      "ps",
      ["-o", "command=", "-p", String(pid)],
      { encoding: "utf8", timeout: 5000 },
      (err, out) => resolve(err ? "" : out)
    )
  );

const signal = (pid: number, sig: NodeJS.Signals | 0) => {
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
};

export interface ReapDeps {
  commandOf?: (pid: number) => Promise<string>;
  /** process.kill: false when there was nothing to signal. */
  kill?: (pid: number, sig: NodeJS.Signals | 0) => boolean;
  waitMs?: number;
}

/**
 * Kills a cloudflared an AgentOS that died left running, named by the pid
 * file, and only if that pid is still one of ours (pids get reused). Call
 * it only while holding connect.lock: then no live AgentOS owns it.
 */
export async function reapTunnel(
  dir: string,
  binDir = path.join(dir, "bin"),
  deps: ReapDeps = {}
) {
  const pidFile = path.join(dir, "cloudflared.pid");
  const kill = deps.kill ?? signal;
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(pidFile, "utf8")) || 0;
  } catch {
    return false;
  }
  let reaped = false;
  if (pid > 1) {
    const command = await (deps.commandOf ?? commandOf)(pid);
    if (command.includes(binDir + path.sep)) {
      // Its group (the watchdog and cloudflared), or a bare cloudflared an
      // older AgentOS started outside one.
      reaped = kill(-pid, "SIGKILL");
      reaped = kill(pid, "SIGKILL") || reaped;
      const end = Date.now() + (deps.waitMs ?? 2000);
      while (kill(pid, 0) && Date.now() < end)
        await new Promise((r) => setTimeout(r, 25));
    }
  }
  fs.rmSync(pidFile, { force: true });
  return reaped;
}

export function superviseTunnel(opts: SuperviseOptions) {
  const log = opts.log ?? (() => {});
  const spawn = opts.spawn ?? spawnTunnel;
  const delays = opts.delays ?? DELAYS;
  const pidFile = path.join(opts.dir, "cloudflared.pid");
  const home = path.join(opts.dir, "cloudflared-home");
  const configFile = path.join(opts.dir, "cloudflared.yml");

  let state: TunnelState = "connecting";
  let reason: string | undefined;
  let stopped = false;
  let child: Child | null = null;
  let timer: NodeJS.Timeout | null = null;
  let delay = delays.min;
  const connections = new Set<string>();
  let logged = { at: 0, n: 0 };

  const say = (line: string) => {
    const now = Date.now();
    if (now - logged.at > 60_000) logged = { at: now, n: 0 };
    if (++logged.n <= LOG_LINES_PER_MINUTE) log(line);
  };

  const retry = (wait: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      tick();
    }, wait);
    timer.unref?.();
  };

  // Nothing here may reject: an unhandled rejection takes AgentOS down.
  const tick = () =>
    void attempt().catch(() => {
      state = "error";
      retry(delays.max);
    });

  const attempt = async () => {
    if (stopped) return;
    state = "connecting";
    try {
      const prepared = await opts.prepare();
      if (stopped) return;
      await run(prepared);
    } catch (err) {
      if (stopped) return;
      const status = err instanceof ApiError ? err.status : 0;
      reason = clean((err as Error)?.message ?? String(err));
      log(`connect: ${reason}`);
      if (status === 401 || status === 403) {
        // Revoked or disabled: it won't fix itself in seconds.
        state = "denied";
        retry(delays.denied);
      } else {
        state = "error";
        retry(delay);
        delay = Math.min(delay * 2, delays.setupMax);
      }
    }
  };

  const run = async ({ bin, token }: Prepared) => {
    const redact = (line: string) => clean(line.split(token).join("[token]"));
    await reapTunnel(opts.dir, path.dirname(bin));
    if (stopped) return;
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    // Its own config and home, so no config.yml elsewhere on the machine
    // changes what it does.
    fs.writeFileSync(configFile, "no-autoupdate: true\n", { mode: 0o600 });
    let proc: Child;
    try {
      proc = spawn(
        bin,
        [
          "tunnel",
          "--config",
          configFile,
          "--no-autoupdate",
          // Never debug: it logs every request's headers, device tokens included.
          "--loglevel",
          "info",
          "--output",
          "json",
          "run",
        ],
        {
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: home,
            TUNNEL_TOKEN: token,
          },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
    } catch (err) {
      state = "error";
      reason = `cloudflared could not start: ${redact((err as Error).message)}`;
      log(`connect: ${reason}`);
      retry(delay);
      delay = Math.min(delay * 2, delays.max);
      return;
    }
    child = proc;
    if (proc.pid) {
      try {
        fs.writeFileSync(pidFile, String(proc.pid), { mode: 0o600 });
      } catch {}
    }

    const onLine = (line: string) => {
      if (!line.trim()) return;
      let entry: {
        level?: string;
        message?: string;
        error?: string;
        connIndex?: number;
      } | null = null;
      if (line.startsWith("{")) {
        try {
          entry = JSON.parse(line);
        } catch {}
      }
      if (!entry) return say(`connect: cloudflared: ${redact(line)}`);
      const message = String(entry.message ?? "");
      const conn = String(entry.connIndex ?? "0");
      if (message.startsWith("Registered tunnel connection")) {
        connections.add(conn);
        if (state !== "up") log("connect: tunnel up");
        state = "up";
        reason = undefined;
        delay = delays.min;
      } else if (
        message.startsWith("Unregistered tunnel connection") ||
        ((entry.level === "error" || entry.level === "fatal") &&
          entry.connIndex !== undefined)
      ) {
        connections.delete(conn);
        if (state === "up" && connections.size === 0) state = "connecting";
      }
      if (["warn", "error", "fatal"].includes(entry.level ?? "")) {
        const text = entry.error ? `${message}: ${entry.error}` : message;
        reason = redact(text);
        say(`connect: cloudflared: ${reason}`);
      }
    };
    for (const stream of [proc.stdout, proc.stderr]) {
      if (!stream) continue;
      stream.on("error", () => {});
      readline.createInterface({ input: stream }).on("line", onLine);
    }

    let ended = false;
    const end = (why: string) => {
      if (ended) return;
      ended = true;
      if (child === proc) child = null;
      connections.clear();
      try {
        if (fs.readFileSync(pidFile, "utf8") === String(proc.pid))
          fs.rmSync(pidFile, { force: true });
      } catch {}
      if (stopped) return;
      state = "connecting";
      reason = why;
      log(`connect: ${why}; starting it again`);
      retry(delay);
      delay = Math.min(delay * 2, delays.max);
    };
    proc.on("error", (err) =>
      end(`cloudflared failed: ${redact(err.message)}`)
    );
    proc.on("exit", (code) => end(`cloudflared exited (${code ?? "signal"})`));
  };

  // A stop that never ran (the process exiting, or a signal nobody else
  // handles) still takes cloudflared's whole group down first.
  const killNow = () => child?.kill("SIGTERM");
  const SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
  const onSignal = (sig: NodeJS.Signals) => {
    killNow();
    for (const s of SIGNALS) process.removeListener(s, onSignal);
    // Nobody else handles it: end the way the signal would have.
    if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
  };
  process.once("exit", killNow);
  for (const s of SIGNALS) process.on(s, onSignal);
  tick();

  return {
    state: () => state,
    reason: () => reason,
    stop() {
      if (stopped) return;
      stopped = true;
      state = "stopped";
      process.removeListener("exit", killNow);
      for (const s of SIGNALS) process.removeListener(s, onSignal);
      if (timer) clearTimeout(timer);
      const proc = child;
      if (!proc) return;
      proc.kill("SIGTERM");
      // It drains connections for a while on SIGTERM; don't wait forever.
      const hard = setTimeout(() => proc.kill("SIGKILL"), 5000);
      hard.unref?.();
      proc.on("exit", () => clearTimeout(hard));
    },
  };
}
