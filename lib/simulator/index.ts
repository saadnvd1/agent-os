/**
 * An iOS simulator a task can drive, on the Mac only. The project declares a
 * `simulator` block in agentos.json; `aos sim open` makes the task its own
 * device (cloned from a base one), runs the project's start command to put
 * the app on it, and `aos sim <command>` drives it through agent-device.
 * Optional: nothing in the merge, review or release paths reads any of this.
 */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { db, type Session } from "../db";
import { isRemoteHost } from "../hosts";
import { simulatorAvailable } from "./available";
import { withPorts, type ProjectConfig } from "../project-config";
import { sessionConfig, sessionProjectEnv } from "../project-config/session";
import {
  buildArgs,
  callTool,
  openArgs,
  ensureInstalled,
  screenshotPath,
  shotsDir,
  simulatorDir,
  type CallResult,
} from "./agent-device";
import {
  RegionError,
  cropToFrame,
  frameOf,
  reducedCopy,
  takeRegion,
} from "./screenshot";
import {
  allLeases,
  bootedCount,
  dropLease,
  getLease,
  maxBooted,
  planSweep,
  putLease,
  touchLease,
  type Lease,
  type SessionFacts,
} from "./lease";
import {
  bootDevice,
  cloneDevice,
  deleteDevice,
  deviceNameFor,
  ensureBase,
  listDevices,
  recentLog,
  shutdownDevice,
} from "./simctl";

const START_TIMEOUT_MS = 25 * 60_000;
const DEFAULT_MODEL = "iPhone 17";

export class SimulatorError extends Error {
  constructor(
    message: string,
    readonly status = 409
  ) {
    super(message);
  }
}

export { simulatorAvailable };
export { shutTaskSimulators, shutFinishedTaskSimulators } from "./task-devices";

const session = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    | Session
    | undefined;

function declared(sessionId: string): {
  config: NonNullable<ProjectConfig["simulator"]>;
  ports: Record<string, number>;
  cwd: string;
} {
  const s = session(sessionId);
  if (!s) throw new SimulatorError("Session not found", 404);
  if (isRemoteHost(s.host_id))
    throw new SimulatorError(
      "This task runs on another machine; its simulator is driven there.",
      409
    );
  const loaded = sessionConfig(sessionId);
  const config = loaded.config.simulator;
  if (!config)
    throw new SimulatorError(
      "This project doesn't declare a simulator (a `simulator` block in agentos.json).",
      400
    );
  if (!simulatorAvailable())
    throw new SimulatorError(
      "The iOS simulator is not available on this machine (a Mac with Xcode is needed). Skip simulator checks and say so in the PR."
    );
  return {
    config,
    ports: loaded.ports ?? {},
    cwd: s.worktree_path || s.working_directory,
  };
}

export interface SimulatorStatus {
  state: Lease["state"] | "none";
  udid: string | null;
  error: string | null;
  shots: string[];
}

function recentShots(sessionId: string, n = 6): string[] {
  try {
    return fs
      .readdirSync(shotsDir(sessionId))
      .filter((f) => f.endsWith(".png"))
      .sort()
      .slice(-n)
      .map((f) => path.join(shotsDir(sessionId), f));
  } catch {
    return [];
  }
}

export function simulatorStatus(sessionId: string): SimulatorStatus {
  const lease = getLease(sessionId);
  return {
    state: lease?.state ?? "none",
    udid: lease?.udid ?? null,
    error: lease?.error ?? null,
    shots: recentShots(sessionId),
  };
}

const tail = (file: string, lines = 15) => {
  try {
    return fs
      .readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .slice(-lines)
      .join("\n");
  } catch {
    return "";
  }
};

// The start command of each task bringing its simulator up, so closing the
// simulator can stop it.
const starts = new Map<string, ChildProcess>();

// Simulator starts running now, for lib/busy: a restart kills them.
export function runningStarts(): number {
  return starts.size;
}

// The whole group: the project's build and Metro are children of the shell.
export function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

export function runStart(
  sessionId: string,
  command: string,
  cwd: string,
  udid: string,
  ports: Record<string, number>
): Promise<void> {
  fs.mkdirSync(simulatorDir(sessionId), { recursive: true });
  const logFile = path.join(simulatorDir(sessionId), "start.log");
  const log = fs.openSync(logFile, "w");
  return new Promise((resolve, reject) => {
    const child = spawn(withPorts(command, ports), {
      cwd,
      shell: true,
      detached: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        ...sessionProjectEnv(sessionId),
        SIMULATOR_UDID: udid,
      },
    });
    starts.set(sessionId, child);
    const timer = setTimeout(() => {
      killGroup(child, "SIGTERM");
      setTimeout(() => killGroup(child, "SIGKILL"), 10_000).unref();
    }, START_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      starts.delete(sessionId);
      fs.closeSync(log);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (starts.get(sessionId) === child) starts.delete(sessionId);
      fs.closeSync(log);
      if (code === 0) resolve();
      else reject(new Error(`start exited ${code}:\n${tail(logFile)}`.trim()));
    });
  });
}

// Bring-ups running in this process. A lease still 'creating' or 'starting'
// without one was cut off by a restart. The token tells a bring-up whether
// it was closed (or replaced) while it ran.
const attempts = new Map<string, symbol>();

class Cancelled extends Error {}

async function bringUp(
  sessionId: string,
  token: symbol,
  config: NonNullable<ProjectConfig["simulator"]>,
  ports: Record<string, number>,
  cwd: string
): Promise<void> {
  const name = deviceNameFor(sessionId);
  let made: string | undefined;
  // Every step is followed by this: closed meanwhile, it stops and tidies up.
  const live = () => {
    if (attempts.get(sessionId) !== token) throw new Cancelled();
  };
  try {
    await ensureInstalled();
    live();
    const base = await ensureBase(config.device ?? DEFAULT_MODEL);
    live();
    const existing = (await listDevices()).find((d) => d.name === name);
    live();
    made = existing?.udid ?? (await cloneDevice(base, name));
    const udid = made;
    live();
    putLease(sessionId, { name, udid, state: "starting" });
    await bootDevice(udid);
    live();
    // The XCTest runner builds once per Xcode version, then is cached; it
    // runs alongside the project's own build.
    const runner = callTool(
      [
        "prepare",
        "ios-runner",
        "--platform",
        "ios",
        "--udid",
        udid,
        "--timeout",
        "900000",
      ],
      15 * 60_000
    );
    await runStart(sessionId, config.start, cwd, udid, ports);
    live();
    const prepared = await runner;
    live();
    if (prepared.code !== 0)
      throw new Error(`the XCTest runner didn't start: ${prepared.stderr}`);
    if (config.app) {
      const opened = await callTool(
        openArgs({ udid, sessionId, app: config.app })
      );
      live();
      if (opened.code !== 0)
        throw new Error(`couldn't attach to ${config.app}: ${opened.stderr}`);
    }
    putLease(sessionId, { name, udid, state: "ready" });
    attempts.delete(sessionId);
  } catch (error) {
    if (error instanceof Cancelled || attempts.get(sessionId) !== token) {
      // Closed while coming up: a device made after the close is not kept
      // unless the close only shut the task's simulator down.
      if (made) {
        const device = { udid: made, name };
        const kept = getLease(sessionId);
        await (kept ? shutdownDevice(device) : deleteDevice(device)).catch(
          () => {}
        );
      }
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[simulator] ${sessionId}: ${message}`);
    attempts.delete(sessionId);
    putLease(sessionId, { name, state: "failed", error: message });
  }
}

// Starts the task's simulator in the background; poll simulatorStatus.
export function openSimulator(sessionId: string): SimulatorStatus {
  const { config, ports, cwd } = declared(sessionId);
  const lease = getLease(sessionId);
  if (lease && (lease.state === "creating" || lease.state === "starting"))
    return simulatorStatus(sessionId);
  if (lease?.state === "ready") {
    touchLease(sessionId);
    return simulatorStatus(sessionId);
  }
  if (bootedCount(sessionId) >= maxBooted())
    throw new SimulatorError(
      `${maxBooted()} simulators are already booted for other tasks; try again in a few minutes.`
    );
  putLease(sessionId, { name: deviceNameFor(sessionId), state: "creating" });
  const token = Symbol(sessionId);
  attempts.set(sessionId, token);
  void bringUp(sessionId, token, config, ports, cwd);
  return simulatorStatus(sessionId);
}

// Boots a shut-down device again (idle past the limit) when the cap allows.
async function wake(sessionId: string, lease: Lease): Promise<void> {
  if (!lease.udid) throw new SimulatorError("The simulator has no device.");
  if (bootedCount(sessionId) >= maxBooted())
    throw new SimulatorError(
      `${maxBooted()} simulators are already booted for other tasks; try again in a few minutes.`
    );
  await bootDevice(lease.udid);
  putLease(sessionId, { name: lease.name, udid: lease.udid, state: "ready" });
}

export async function runSimulator(
  sessionId: string,
  args: string[]
): Promise<CallResult & { screenshot: string | null; read: string | null }> {
  const { config, cwd } = declared(sessionId);
  let lease = getLease(sessionId);
  if (!lease || lease.state === "failed")
    throw new SimulatorError("No simulator is open. Run `aos sim open`.");
  if (lease.state !== "ready" && lease.state !== "shutdown")
    throw new SimulatorError(
      "The simulator is still starting. Run `aos sim status`."
    );
  if (lease.state === "shutdown") {
    await wake(sessionId, lease);
    lease = getLease(sessionId)!;
  }
  let region: string | null = null;
  if (args[0] === "screenshot") {
    try {
      ({ args, region } = takeRegion(args));
    } catch (error) {
      throw new SimulatorError((error as Error).message, 400);
    }
  }
  const target = { udid: lease.udid!, sessionId, app: config.app, cwd };
  let argv: string[];
  try {
    argv = buildArgs(args, target);
  } catch (error) {
    throw new SimulatorError((error as Error).message, 400);
  }
  const shot = screenshotPath(argv);
  if (shot) fs.mkdirSync(path.dirname(shot), { recursive: true });
  touchLease(sessionId);
  // The element's frame comes from a fresh snapshot, before the shot, so a
  // bad ref fails without writing anything.
  let located: ReturnType<typeof frameOf> | null = null;
  if (region) {
    const snap = await callTool(
      buildArgs(["snapshot", "-i", "--json"], target)
    );
    try {
      if (snap.code) throw new RegionError(snap.stderr || "snapshot failed");
      located = frameOf(snap.stdout, region);
    } catch (error) {
      if (error instanceof RegionError)
        throw new SimulatorError(error.message, 400);
      throw error;
    }
  }
  const result = await callTool(argv);
  const taken = shot && fs.existsSync(shot) ? shot : null;
  let note = "";
  if (taken && located) {
    try {
      await cropToFrame(taken, located.frame, located.screen);
    } catch (error) {
      note = `region crop failed (${(error as Error).message}); kept the full screen\n`;
    }
  }
  const read = taken ? await reducedCopy(taken) : null;
  touchLease(sessionId);
  return {
    ...result,
    stderr: result.stderr + note,
    screenshot: taken,
    read,
  };
}

export async function simulatorLogs(sessionId: string, last: string) {
  const { config } = declared(sessionId);
  const lease = getLease(sessionId);
  if (!lease?.udid) throw new SimulatorError("No simulator is open.");
  if (!config.app)
    throw new SimulatorError("The project doesn't name its app.");
  if (!/^\d+[smh]$/.test(last))
    throw new SimulatorError("--last takes a duration like 2m", 400);
  touchLease(sessionId);
  // The app's process name is its bundle id's last part by default.
  return recentLog(lease.udid, config.app.split(".").pop() ?? config.app, last);
}

// Ends the task's simulator. `remove` deletes the device (the task is over);
// otherwise it is only shut down and comes back on the next call. Never
// throws and never waits for its caller: the agent's end must not hang on it.
export async function releaseSimulator(
  sessionId: string,
  opts: { remove: boolean }
): Promise<void> {
  const lease = getLease(sessionId);
  if (!lease) return;
  // A bring-up still running stops at its next step; so does its build.
  attempts.delete(sessionId);
  const start = starts.get(sessionId);
  if (start) killGroup(start, "SIGTERM");
  try {
    if (lease.udid) {
      await callTool([
        "close",
        "--platform",
        "ios",
        "--udid",
        lease.udid,
        "--session",
        `aos-${sessionId.replace(/-/g, "").slice(0, 8)}`,
      ]).catch(() => {});
      if (opts.remove)
        await deleteDevice({ udid: lease.udid, name: lease.name });
      else await shutdownDevice({ udid: lease.udid, name: lease.name });
    }
    if (opts.remove) {
      dropLease(sessionId);
      fs.rmSync(simulatorDir(sessionId), { recursive: true, force: true });
    } else putLease(sessionId, { name: lease.name, state: "shutdown" });
  } catch (error) {
    console.error(`[simulator] release ${sessionId}:`, error);
  }
}

// Runs on the Mac only, and only does anything where a lease exists.
export function releaseOnEnd(sessionId: string, opts: { remove: boolean }) {
  if (!getLease(sessionId)) return;
  void releaseSimulator(sessionId, opts);
}

const ENDED = new Set(["merged", "dropped", "done", "moved"]);

// Tidies leases and devices left by tasks that ended or crashed: ended tasks'
// devices go, idle ones are shut down, and this instance's unclaimed devices
// are deleted.
export async function sweepSimulators(): Promise<void> {
  if (!simulatorAvailable()) return;
  const devices = await listDevices();
  const leases = allLeases();
  const sessions = new Map<string, SessionFacts>();
  for (const l of leases) {
    const s = session(l.session_id);
    sessions.set(l.session_id, {
      ended: !s || !!s.archived_at || ENDED.has(s.task_status ?? ""),
    });
  }
  const plan = planSweep(
    leases,
    devices,
    sessions,
    Date.now(),
    undefined,
    new Set(attempts.keys())
  );
  // Bring-ups a restart cut off: their device is shut down and the slot freed.
  for (const i of plan.interrupted) {
    if (i.device)
      await shutdownDevice(i.device).catch((e) =>
        console.error("[simulator] sweep shutdown:", e)
      );
    putLease(i.sessionId, {
      name: i.name,
      state: "failed",
      error: "interrupted by a restart; run `aos sim open` again",
    });
  }
  for (const r of plan.remove) {
    await deleteDevice(r.device).catch((e) =>
      console.error("[simulator] sweep delete:", e)
    );
    if (r.sessionId) {
      dropLease(r.sessionId);
      fs.rmSync(simulatorDir(r.sessionId), { recursive: true, force: true });
    }
  }
  for (const s of plan.shutdown) {
    await shutdownDevice(s).catch((e) =>
      console.error("[simulator] sweep shutdown:", e)
    );
    const lease = getLease(s.sessionId);
    if (lease) putLease(s.sessionId, { name: lease.name, state: "shutdown" });
  }
  for (const id of plan.dropLeases) dropLease(id);
}
