/**
 * Keeps `cloudflared tunnel run` going while Connect is on. Each start asks
 * the Connect service for a fresh connector token, which goes to the child
 * in TUNNEL_TOKEN only: never argv, never a file, never a log line. The
 * child exits → it's started again with backoff; stop() ends it.
 */

import { execFileSync, spawn as nodeSpawn } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import type { Readable } from "stream";
import { ApiError, clean } from "./control-api";

export type TunnelState = "connecting" | "up" | "denied" | "error" | "stopped";

export interface Prepared {
  bin: string;
  token: string;
}

interface Child {
  pid?: number;
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

/** A cloudflared left running by an AgentOS that died without stopping it. */
function stopStale(pidFile: string, binDir: string) {
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(pidFile, "utf8")) || 0;
  } catch {
    return;
  }
  if (pid > 1) {
    try {
      const command = execFileSync(
        "ps",
        ["-o", "command=", "-p", String(pid)],
        {
          encoding: "utf8",
          timeout: 5000,
        }
      );
      if (command.startsWith(binDir + path.sep)) process.kill(pid, "SIGTERM");
    } catch {}
  }
  fs.rmSync(pidFile, { force: true });
}

export function superviseTunnel(opts: SuperviseOptions) {
  const log = opts.log ?? (() => {});
  const spawn = opts.spawn ?? (nodeSpawn as unknown as Spawn);
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
      void attempt();
    }, wait);
    timer.unref?.();
  };

  const attempt = async () => {
    if (stopped) return;
    state = "connecting";
    let prepared: Prepared;
    try {
      prepared = await opts.prepare();
    } catch (err) {
      if (stopped) return;
      const status = err instanceof ApiError ? err.status : 0;
      reason = clean((err as Error).message);
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
      return;
    }
    if (stopped) return;
    run(prepared);
  };

  const run = ({ bin, token }: Prepared) => {
    const redact = (line: string) => clean(line.split(token).join("[token]"));
    stopStale(pidFile, path.dirname(bin));
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

  const killNow = () => child?.kill("SIGTERM");
  process.once("exit", killNow);
  void attempt();

  return {
    state: () => state,
    reason: () => reason,
    stop() {
      if (stopped) return;
      stopped = true;
      state = "stopped";
      process.removeListener("exit", killNow);
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
