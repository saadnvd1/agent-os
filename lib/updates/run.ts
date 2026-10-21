// Running an update, only when someone asks. The server does no more than
// check the checkout and start scripts/update-run.mjs detached; that runs
// scripts/redeploy (pull, install, build beside the live server, swap,
// restart) and writes where it is to a state file, which the restart outlives.

import { spawn, execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { git } from "@/lib/git-exec";
import { buildId } from "@/lib/build";
import {
  isActivePhase,
  workingTotal,
  type UpdateRefusal,
  type UpdateRun,
  type UpdateView,
} from "./banner";
import {
  checkForUpdate,
  realDeps as realCheckDeps,
  type CheckDeps,
  type CheckResult,
} from "./check";
import { getSetting, putSetting } from "./settings";

const exec = promisify(execFile);

export const STALE_RUN_MS = 30 * 60_000;
export const PENDING_EXPIRES_MS = 24 * 60 * 60_000;
export const IDLE_TICK_MS = 30_000;
const PENDING_KEY = "updates.pending";
const CLAIM_STALE_MS = 2 * 60_000;

export interface RunDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  git: (args: string[]) => Promise<string>;
  check: CheckDeps;
  now: () => number;
  stateFile: string;
  logFile: string;
  lockHeld: () => boolean;
  restartCommand: () => Promise<string | null>;
  spawnRunner: (env: NodeJS.ProcessEnv, logFile: string) => void;
  buildId: () => string;
  working: () => Promise<UpdateView["working"]>;
  getSetting: (key: string) => string | null;
  putSetting: (key: string, value: string | null) => void;
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

async function parentOf(pid: number): Promise<number> {
  const { stdout } = await exec("ps", ["-o", "ppid=", "-p", String(pid)], {
    timeout: 2_000,
  });
  return Number(stdout.trim()) || 0;
}

/** True when this process was started by `agent-os start` from this checkout. */
async function startedByCli(cwd: string, env: RunDeps["env"]) {
  try {
    const home = env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
    if (fs.realpathSync(path.join(home, "repo")) !== fs.realpathSync(cwd))
      return false;
    const pid = Number(
      fs.readFileSync(path.join(home, "agent-os.pid"), "utf8")
    );
    let p = process.pid;
    for (let i = 0; i < 6 && p > 1; i++) {
      if (p === pid) return true;
      p = await parentOf(p);
    }
  } catch {}
  return false;
}

/** AGENTOS_RESTART, else the CLI's restart when it started this server, else none. */
export async function resolveRestart(
  cwd: string,
  env: RunDeps["env"],
  cli: () => Promise<boolean> = () => startedByCli(cwd, env)
): Promise<string | null> {
  if (env.AGENTOS_RESTART) return env.AGENTOS_RESTART;
  if (await cli())
    return `${shellQuote(path.join(cwd, "scripts/agent-os"))} restart`;
  return null;
}

function updateDir(env: RunDeps["env"], cwd: string) {
  return env.DB_PATH ? path.dirname(path.resolve(env.DB_PATH)) : cwd;
}

export function realRunDeps(): RunDeps {
  const cwd = process.cwd();
  const env = process.env;
  const dir = updateDir(env, cwd);
  return {
    cwd,
    env,
    git: (args) => git(cwd, args, { timeout: 30_000 }),
    check: realCheckDeps(cwd),
    now: Date.now,
    stateFile: path.join(dir, "agent-os-update.json"),
    logFile: path.join(dir, "agent-os-update.log"),
    lockHeld: () => {
      try {
        return (
          Date.now() - fs.statSync(path.join(cwd, ".next-build.lock")).mtimeMs <
          STALE_RUN_MS
        );
      } catch {
        return false;
      }
    },
    restartCommand: () => resolveRestart(cwd, env),
    spawnRunner: (runnerEnv, logFile) => {
      const fd = fs.openSync(logFile, "w");
      const child = spawn(
        process.execPath,
        [path.join(cwd, "scripts/update-run.mjs")],
        {
          cwd,
          detached: true,
          stdio: ["ignore", fd, fd],
          env: runnerEnv,
        }
      );
      child.on("error", () => {});
      child.unref();
      fs.closeSync(fd);
    },
    buildId,
    working: workingSummary,
    getSetting,
    putSetting,
  };
}

export async function workingSummary(): Promise<UpdateView["working"]> {
  const { inFlight } = await import("@/lib/busy");
  const { collectStatuses } = await import("@/lib/status/collect");
  const { reviews, setups } = inFlight();
  const { statuses } = await collectStatuses();
  const sessions = Object.values(statuses).filter(
    (s) => s.status === "running"
  ).length;
  return { sessions, reviews, setups };
}

// ── run state ────────────────────────────────────────────────────────────

export function readRun(
  deps: Pick<RunDeps, "stateFile" | "now">
): UpdateRun | null {
  try {
    const run = JSON.parse(
      fs.readFileSync(deps.stateFile, "utf8")
    ) as UpdateRun;
    if (!run?.id || !run.phase) return null;
    // A run that stopped writing was cut off (the machine went down).
    if (isActivePhase(run.phase) && deps.now() - run.startedAt > STALE_RUN_MS)
      return {
        ...run,
        phase: "failed",
        error: "The update stopped answering; see the update log.",
      };
    return run;
  } catch {
    return null;
  }
}

export function writeRun(file: string, run: UpdateRun): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run));
  fs.renameSync(tmp, file);
}

export function readLog(deps: Pick<RunDeps, "logFile">, lines = 30): string[] {
  try {
    return fs
      .readFileSync(deps.logFile, "utf8")
      .trimEnd()
      .split("\n")
      .slice(-lines);
  } catch {
    return [];
  }
}

// ── refusals ─────────────────────────────────────────────────────────────

export type Refusal = { code: UpdateRefusal; error: string };

/** Why this checkout can't be updated now; null when it can. No network. */
export const NO_RESTART =
  "This server can't restart itself, so an update would leave the old build running on new files. Set AGENTOS_RESTART to its restart command, or start it with agent-os start.";

export async function preflight(
  check: CheckResult | null,
  deps: RunDeps
): Promise<Refusal | null> {
  if (deps.env.AGENTOS_DEV === "1")
    return {
      code: "dev",
      error: "This is a dev server; update its checkout with git.",
    };
  const inRepo = await deps.git(["rev-parse", "--git-dir"]).then(
    () => true,
    () => false
  );
  if (!inRepo)
    return {
      code: "not_git",
      error:
        "AgentOS isn't running from a git checkout, so it can't update itself.",
    };
  const run = readRun(deps);
  if (run && isActivePhase(run.phase))
    return {
      code: "running",
      error: `An update is already in progress (${run.phase}).`,
    };
  if (deps.lockHeld())
    return {
      code: "building",
      error:
        "Another update or deploy is building. Try again when it finishes.",
    };
  const dirty = (
    await deps.git(["status", "--porcelain", "--untracked-files=no"])
  )
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
  if (dirty.length)
    return {
      code: "dirty",
      error: `This checkout has local changes: ${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ` and ${dirty.length - 5} more` : ""}. Commit or discard them, then update.`,
    };
  if (!check || check.status === "unknown")
    return {
      code: "unknown",
      error: `Couldn't look for updates${check?.error ? `: ${check.error}` : "."}`,
    };
  const branch = (await deps.git(["branch", "--show-current"])).trim();
  if (check.branch && branch !== check.branch)
    return {
      code: "branch",
      error: `This checkout is on ${branch || "a detached HEAD"}, not ${check.branch}. Switch back to update.`,
    };
  if (check.status === "diverged")
    return {
      code: "diverged",
      error:
        "This checkout has commits the remote doesn't, so it can't fast-forward.",
    };
  if (!check.available)
    return { code: "up_to_date", error: "AgentOS is up to date." };
  if (!(await deps.restartCommand()))
    return { code: "no_restart", error: NO_RESTART };
  return null;
}

// ── starting ─────────────────────────────────────────────────────────────

export type StartResult =
  { ok: true; pending: boolean } | ({ ok: false } & Refusal);

/** Takes the right to start, atomically, so two requests can't both run. */
function claimStart(deps: Pick<RunDeps, "stateFile" | "now">): boolean {
  const file = `${deps.stateFile}.claim`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.closeSync(fs.openSync(file, "wx"));
      return true;
    } catch {
      try {
        if (Date.now() - fs.statSync(file).mtimeMs < CLAIM_STALE_MS)
          return false;
        fs.unlinkSync(file);
      } catch {}
    }
  }
  return false;
}

const releaseStart = (deps: Pick<RunDeps, "stateFile">) => {
  try {
    fs.unlinkSync(`${deps.stateFile}.claim`);
  } catch {}
};

export async function startUpdate(
  { when }: { when: "now" | "idle" },
  deps: RunDeps = realRunDeps()
): Promise<StartResult> {
  if (!claimStart(deps))
    return {
      ok: false,
      code: "running",
      error: "An update is already starting.",
    };
  try {
    return await begin(when, deps);
  } finally {
    releaseStart(deps);
  }
}

async function begin(
  when: "now" | "idle",
  deps: RunDeps
): Promise<StartResult> {
  const { result } = await checkForUpdate({ force: true }, deps.check);
  // A failed look can't vouch for the cached answer.
  if (result.error)
    return {
      ok: false,
      code: "unknown",
      error: `Couldn't look for updates: ${result.error}`,
    };
  const refused = await preflight(result, deps);
  if (refused) return { ok: false, ...refused };
  if (when === "idle") {
    deps.putSetting(
      PENDING_KEY,
      JSON.stringify({ requestedAt: deps.now(), from: result.current!.sha })
    );
    return { ok: true, pending: true };
  }
  deps.putSetting(PENDING_KEY, null);
  const id = `${deps.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  writeRun(deps.stateFile, {
    id,
    phase: "starting",
    from: result.current!.sha,
    fromVersion: result.current!.version,
    toVersion: result.latest!.version,
    startedAt: deps.now(),
  });
  const restart = (await deps.restartCommand())!;
  const env = { ...deps.env } as NodeJS.ProcessEnv;
  // The restarted server must work out its own build, not inherit this one.
  delete env.AGENTOS_BUILD;
  delete env.AGENTOS_RESTART;
  env.AGENTOS_UPDATE_STATE = deps.stateFile;
  env.AGENTOS_UPDATE_ID = id;
  env.AGENTOS_RESTART = restart;
  if (deps.env.PORT) env.PORT = deps.env.PORT;
  deps.spawnRunner(env, deps.logFile);
  return { ok: true, pending: false };
}

// ── update when idle ─────────────────────────────────────────────────────

export function readPending(
  deps: Pick<RunDeps, "getSetting" | "now" | "putSetting">
): { requestedAt: number } | null {
  const raw = deps.getSetting(PENDING_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { requestedAt: number };
    if (deps.now() - p.requestedAt < PENDING_EXPIRES_MS) return p;
  } catch {}
  deps.putSetting(PENDING_KEY, null);
  return null;
}

export const cancelPending = (
  deps: Pick<RunDeps, "putSetting"> = realRunDeps()
) => deps.putSetting(PENDING_KEY, null);

/**
 * Starts a requested "update when idle" once nothing has been working for two
 * checks in a row, so a gap between two turns doesn't count as quiet.
 */
export function createIdleWatcher(deps: RunDeps = realRunDeps()) {
  let quiet = 0;
  let busy = false;
  const tick = async (): Promise<"none" | "waiting" | "started"> => {
    if (!readPending(deps)) {
      quiet = 0;
      return "none";
    }
    const run = readRun(deps);
    if (run && isActivePhase(run.phase)) return "waiting";
    quiet = workingTotal(await deps.working()) === 0 ? quiet + 1 : 0;
    if (quiet < 2) return "waiting";
    quiet = 0;
    const started = await startUpdate({ when: "now" }, deps);
    if (!started.ok) {
      // Don't retry a refused request every tick for a day.
      deps.putSetting(PENDING_KEY, null);
      writeRun(deps.stateFile, {
        id: `idle${deps.now().toString(36)}`,
        phase: "failed",
        from: "",
        fromVersion: "",
        toVersion: "",
        startedAt: deps.now(),
        finishedAt: deps.now(),
        error: started.error,
      });
    }
    return "started";
  };
  return {
    async tick() {
      if (busy) return "waiting";
      busy = true;
      try {
        return await tick();
      } finally {
        busy = false;
      }
    },
  };
}

const g = globalThis as unknown as { __agentosIdleWatcher?: NodeJS.Timeout };

export function startIdleWatcher(): void {
  if (g.__agentosIdleWatcher) return;
  const watcher = createIdleWatcher();
  g.__agentosIdleWatcher = setInterval(() => {
    watcher.tick().catch((error) => console.error("Update when idle:", error));
  }, IDLE_TICK_MS);
  g.__agentosIdleWatcher.unref();
}

// ── after a restart ──────────────────────────────────────────────────────

/** A run that reached "restarting" is done if this server runs a newer build. */
export function reconcileOnBoot(deps: RunDeps = realRunDeps()): void {
  const run = readRun(deps);
  if (!run || run.phase !== "restarting") return;
  const moved = deps.buildId() !== run.from;
  writeRun(deps.stateFile, {
    ...run,
    phase: moved ? "done" : "failed",
    finishedAt: deps.now(),
    ...(moved
      ? {}
      : {
          error:
            "The server restarted without the new build; see the update log.",
          log: readLog(deps),
        }),
  });
}
