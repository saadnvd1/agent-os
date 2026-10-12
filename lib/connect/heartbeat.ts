/**
 * Tells the Connect service this machine is alive: one signed beat when
 * Connect starts, then one a minute. The answer can switch the machine off
 * (the account disabled it) or say it is gone (removed from the account).
 * Nothing here may throw: a rejection would take AgentOS down.
 */

import fs from "fs";
import path from "path";
import { ApiError, clean } from "./control-api";

export const HEARTBEAT_MS = 60_000;

export interface HeartbeatOptions {
  beat: () => Promise<{ enabled: boolean }>;
  /** The account disabled this machine: stop the tunnel. */
  onDisabled: () => void;
  /** The service no longer knows this machine. */
  onGone: () => void;
  log?: (line: string) => void;
  intervalMs?: number;
}

export function startHeartbeat(opts: HeartbeatOptions) {
  const log = opts.log ?? (() => {});
  const every = opts.intervalMs ?? HEARTBEAT_MS;
  let stopped = false;
  let failing = false;
  let timer: NodeJS.Timeout | null = null;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const next = () => {
    if (stopped) return;
    timer = setTimeout(tick, every);
    timer.unref?.();
  };

  const tick = async () => {
    timer = null;
    try {
      const { enabled } = await opts.beat();
      if (stopped) return;
      failing = false;
      if (enabled === false) {
        stop();
        log("connect: this machine was disabled in your account; tunnel off");
        opts.onDisabled();
        return;
      }
    } catch (err) {
      if (stopped) return;
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401 || status === 404) {
        stop();
        log("connect: machine no longer linked, run agent-os connect");
        opts.onGone();
        return;
      }
      if (!failing) {
        failing = true;
        log(
          `connect: heartbeat failed: ${clean((err as Error)?.message ?? String(err))}; retrying`
        );
      }
    }
    next();
  };

  void tick();
  return { stop };
}

/** The running AgentOS version, from package.json. */
export function appVersion(cwd = process.cwd()): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8")
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
