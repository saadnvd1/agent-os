// Running an update, when someone asks or, with automatic updates on, once
// everything has been idle (lib/updates/auto.ts decides when). The server
// does no more than check the checkout and start scripts/update-run.mjs
// detached; that backs up the database, runs scripts/redeploy (pull,
// install, build beside the live server, swap, restart), checks the new
// server and rolls back when it isn't healthy, writing where it is to a
// state file, which the restart outlives.

import { spawn, execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { git } from "@/lib/git-exec";
import { buildId } from "@/lib/build";
import { agentosHome } from "@/lib/agentos-home";
import { dbPath } from "@/lib/db/path";
import {
  isActivePhase,
  workingTotal,
  type AutoUpdateView,
  type UpdateRefusal,
  type UpdateRun,
  type UpdateView,
} from "./banner";
import {
  cachedCheck,
  checkForUpdate,
  realDeps as realCheckDeps,
  reconcile,
  versionAt,
  type CheckDeps,
  type CheckResult,
} from "./check";
import { decideAutoUpdate, pickTarget, type AutoDecision } from "./auto";
import {
  attemptOf,
  failedInARow,
  readAttempts,
  recordAttempt,
} from "./history";
import {
  autoEnabled,
  autoLocked,
  deadlineMs,
  getSetting,
  idleMinutes,
  idleMinutesLocked,
  minFreeBytes,
  putSetting,
  soakMs,
} from "./settings";

const exec = promisify(execFile);

export const STALE_RUN_MS = 30 * 60_000;
/** A runner that hasn't written for this long, and whose pid is gone, was cut off. */
export const HEARTBEAT_STALE_MS = 2 * 60_000;
/** autodeploy touches its heartbeat every minute or two; older means it stopped. */
const MANAGED_FRESH_MS = 15 * 60_000;
/** A refused automatic update isn't asked about again for this long. */
const AUTO_REFUSED_MS = 30 * 60_000;
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
  /** Free bytes on the checkout's disk; null when it can't tell. */
  freeBytes: () => number | null;
  /** True when scripts/autodeploy deploys this checkout. */
  managed: () => boolean;
  /** What a restart would interrupt, as short labels; empty when nothing. */
  busy: () => Promise<string[]>;
  /** The database the runner backs up first, and where to. */
  dbFile: string | null;
  backupDir: string | null;
  notify: (text: string) => void;
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

/**
 * False when systemd runs this server from a unit written before it set
 * KillMode=process: restarting that unit would stop terminals, chat workers
 * and the update itself with it.
 */
function systemdUnitOk(env: RunDeps["env"]): boolean {
  if (!env.INVOCATION_ID) return true;
  try {
    const unit = fs.readFileSync(
      path.join(os.homedir(), ".config/systemd/user/agent-os.service"),
      "utf8"
    );
    return /^KillMode=process$/m.test(unit);
  } catch {
    return true;
  }
}

/** AGENTOS_RESTART, else the CLI's restart when it started this server, else none. */
export async function resolveRestart(
  cwd: string,
  env: RunDeps["env"],
  cli: () => Promise<boolean> = () => startedByCli(cwd, env),
  unitOk: () => boolean = () => systemdUnitOk(env)
): Promise<string | null> {
  if (env.AGENTOS_RESTART) return env.AGENTOS_RESTART;
  if ((await cli()) && unitOk())
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
    freeBytes: () => {
      try {
        const st = fs.statfsSync(cwd);
        return st.bavail * st.bsize;
      } catch {
        return null;
      }
    },
    managed: () => {
      try {
        const at = fs.statSync(agentosHome("autodeploy", "heartbeat")).mtimeMs;
        return Date.now() - at < MANAGED_FRESH_MS;
      } catch {
        return false;
      }
    },
    busy: busyLabels,
    dbFile: path.resolve(dbPath()),
    backupDir: agentosHome("backups"),
    notify: (text) => {
      import("@/lib/notify")
        .then(({ notifyPhone }) => notifyPhone("updates", text))
        .catch(() => {});
    },
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Everything a restart would interrupt, for automatic updates. */
export async function busyLabels(): Promise<string[]> {
  const { inFlight } = await import("@/lib/busy");
  const { sessions } = await workingSummary();
  const f = inFlight();
  const out: string[] = [];
  if (sessions) out.push(`${plural(sessions, "session")} working`);
  if (f.reviews) out.push(plural(f.reviews, "review"));
  if (f.setups) out.push(`${plural(f.setups, "task")} setting up`);
  if (f.simulatorStarts) out.push(plural(f.simulatorStarts, "simulator start"));
  if (f.merges) out.push(plural(f.merges, "merge"));
  if (f.landings) out.push(`${plural(f.landings, "stack")} landing`);
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, ".next-build.lock"))) out.push("a build");
  try {
    if (fs.existsSync(agentosHome("autodeploy", "lock"))) out.push("a deploy");
  } catch {}
  return out;
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

export function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A run in an active phase that nothing is running any more. */
export function isStaleRun(run: UpdateRun, now: number): boolean {
  if (!isActivePhase(run.phase)) return false;
  if (run.updatedAt)
    return now - run.updatedAt > HEARTBEAT_STALE_MS && !pidAlive(run.pid);
  return now - run.startedAt > STALE_RUN_MS;
}

export function readRun(
  deps: Pick<RunDeps, "stateFile" | "now">
): UpdateRun | null {
  try {
    const run = JSON.parse(
      fs.readFileSync(deps.stateFile, "utf8")
    ) as UpdateRun;
    if (!run?.id || !run.phase) return null;
    // A run that stopped writing was cut off (the machine went down).
    if (isStaleRun(run, deps.now()))
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
  "This server can't restart itself, so an update would leave the old build running on new files. Set AGENTOS_RESTART to its restart command, or start it with agent-os start (started at login on Linux: run agent-os enable again to update its service).";

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
  const free = deps.freeBytes();
  const need = minFreeBytes(deps.env);
  if (free !== null && need > 0 && free < need)
    return {
      code: "disk",
      error: `Not enough free disk space to update: ${(free / 1024 ** 3).toFixed(1)} GB free, an update needs ${(need / 1024 ** 3).toFixed(0)} GB.`,
    };
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
  {
    when,
    to,
    auto = false,
  }: { when: "now" | "idle"; to?: string; auto?: boolean },
  deps: RunDeps = realRunDeps()
): Promise<StartResult> {
  if (!claimStart(deps))
    return {
      ok: false,
      code: "running",
      error: "An update is already starting.",
    };
  try {
    return await begin(when, deps, to, auto);
  } finally {
    releaseStart(deps);
  }
}

async function begin(
  when: "now" | "idle",
  deps: RunDeps,
  to: string | undefined,
  auto: boolean
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
  // An automatic update takes a soaked commit, which may be behind the head.
  let target = { sha: result.latest!.sha, version: result.latest!.version };
  if (to && to !== target.sha) {
    if (!result.candidates?.some((c) => c.sha === to))
      return {
        ok: false,
        code: "up_to_date",
        error: `${to.slice(0, 7)} isn't a newer version of this checkout.`,
      };
    target = await versionAt(deps.check.git, to).catch(() => ({
      sha: to,
      version: to.slice(0, 7),
    }));
  }
  deps.putSetting(PENDING_KEY, null);
  const id = `${deps.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  writeRun(deps.stateFile, {
    id,
    phase: "starting",
    from: result.current!.sha,
    fromVersion: result.current!.version,
    to: target.sha,
    toVersion: target.version,
    startedAt: deps.now(),
    updatedAt: deps.now(),
    ...(auto ? { auto: true } : {}),
  });
  const restart = (await deps.restartCommand())!;
  const env = { ...deps.env } as NodeJS.ProcessEnv;
  // The restarted server must work out its own build, not inherit this one.
  delete env.AGENTOS_BUILD;
  delete env.AGENTOS_RESTART;
  env.AGENTOS_UPDATE_STATE = deps.stateFile;
  env.AGENTOS_UPDATE_ID = id;
  env.AGENTOS_RESTART = restart;
  env.AGENTOS_UPDATE_TO = target.sha;
  delete env.AGENTOS_UPDATE_DB;
  delete env.AGENTOS_UPDATE_BACKUPS;
  if (deps.dbFile && deps.backupDir) {
    env.AGENTOS_UPDATE_DB = deps.dbFile;
    env.AGENTOS_UPDATE_BACKUPS = deps.backupDir;
  }
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

// ── automatic updates ────────────────────────────────────────────────────

const PAUSES: ReadonlySet<UpdateRefusal> = new Set<UpdateRefusal>([
  "dev",
  "not_git",
  "dirty",
  "branch",
  "diverged",
  "unknown",
  "no_restart",
  "disk",
]);

/** What the watcher saw last, for Settings. */
interface AutoMemory {
  quietSince: number | null;
  busy: string[];
  refusal: { text: string; until: number } | null;
}
const gm = globalThis as unknown as { __agentosAutoMemory?: AutoMemory };
const memory = (): AutoMemory =>
  (gm.__agentosAutoMemory ??= { quietSince: null, busy: [], refusal: null });
export const resetAutoMemory = () => {
  gm.__agentosAutoMemory = { quietSince: null, busy: [], refusal: null };
};

/** Files a finished run in the history, once, and tells the phone when it matters. */
export function recordFinishedRun(deps: RunDeps): void {
  const attempt = attemptOf(readRun(deps));
  if (!attempt || !recordAttempt(deps.getSetting, deps.putSetting, attempt))
    return;
  if (!attempt.auto) return;
  const version = attempt.toVersion || attempt.to.slice(0, 7);
  if (attempt.outcome === "broken")
    deps.notify(
      `AgentOS couldn't update to ${version} and rolling back didn't work either. Open Settings → Updates on that machine.`
    );
  else if (failedInARow(readAttempts(deps.getSetting)) === 3)
    deps.notify(
      `AgentOS has failed to update itself 3 times in a row (last: ${version}). It keeps running the version it has; Settings → Updates says why.`
    );
}

/** The cached check, brought up to date with the checkout cheaply. */
async function currentCheck(deps: RunDeps): Promise<CheckResult | null> {
  const check = cachedCheck(deps.check);
  if (!check?.candidates?.length) return check;
  // The server's own build is HEAD unless someone pulled under it.
  if (check.current?.sha === deps.buildId()) return check;
  return reconcile(check, deps.check);
}

function autoInput(deps: RunDeps, check: CheckResult | null) {
  const mem = memory();
  const now = deps.now();
  const refusal =
    mem.refusal && mem.refusal.until > now ? mem.refusal.text : null;
  return {
    enabled: autoEnabled(deps.env, deps.getSetting),
    locked: autoLocked(deps.env),
    managed: deps.managed(),
    refusal,
    candidates: check?.available ? (check.candidates ?? []) : [],
    attempts: readAttempts(deps.getSetting),
    busy: mem.busy,
    quietSince: mem.quietSince,
    now,
    soakMs: soakMs(deps.env),
    idleMs: idleMinutes(deps.env, deps.getSetting) * 60_000,
    deadlineMs: deadlineMs(deps.env),
  };
}

/** One look: start an automatic update when it's time. */
async function autoTick(
  deps: RunDeps
): Promise<"none" | "waiting" | "started"> {
  const mem = memory();
  const input = autoInput(deps, await currentCheck(deps));
  // Off, managed, refused or up to date: nothing to watch.
  const first = decideAutoUpdate({ ...input, busy: [], quietSince: 0 });
  if (first.action === "skip" || !("eligibleSince" in pickTarget(input))) {
    mem.quietSince = null;
    mem.busy = [];
    return "none";
  }
  const busy = await deps.busy();
  mem.busy = busy;
  mem.quietSince = busy.length ? null : (mem.quietSince ?? input.now);
  const decision = decideAutoUpdate({
    ...input,
    busy,
    quietSince: mem.quietSince,
  });
  if (decision.action !== "start") return "waiting";
  mem.quietSince = null;
  const started = await startUpdate(
    { when: "now", to: decision.to, auto: true },
    deps
  );
  if (!started.ok && PAUSES.has(started.code))
    mem.refusal = { text: started.error, until: input.now + AUTO_REFUSED_MS };
  return started.ok ? "started" : "waiting";
}

/** What automatic updates are doing, for the /api/updates payload. */
export async function autoView(
  deps: RunDeps,
  check: CheckResult | null,
  refusal: { code: UpdateRefusal; error: string } | null
): Promise<AutoUpdateView> {
  const input = autoInput(deps, check);
  const run = readRun(deps);
  let status: AutoDecision | { code: string; text: string };
  if (run && isActivePhase(run.phase))
    status = { code: "running", text: "An update is running." };
  else
    status = decideAutoUpdate({
      ...input,
      refusal:
        refusal && PAUSES.has(refusal.code) ? refusal.error : input.refusal,
    });
  return {
    enabled: input.enabled,
    locked: input.locked,
    managed: input.managed,
    idleMinutes: idleMinutes(deps.env, deps.getSetting),
    idleLocked: idleMinutesLocked(deps.env),
    status:
      "text" in status
        ? { code: status.code, text: status.text }
        : { code: "starting", text: "Starting an update." },
    attempts: input.attempts.slice(0, 5),
  };
}

// ── the watcher ──────────────────────────────────────────────────────────

/**
 * Every 30 seconds: files finished runs in the history, starts a requested
 * "update when idle" once nothing has been working for two checks in a row
 * (so a gap between two turns doesn't count as quiet), and otherwise runs
 * automatic updates.
 */
export function createIdleWatcher(deps: RunDeps = realRunDeps()) {
  let quiet = 0;
  let busy = false;
  const manual = async (): Promise<"waiting" | "started"> => {
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
  const tick = async (): Promise<"none" | "waiting" | "started"> => {
    recordFinishedRun(deps);
    const run = readRun(deps);
    if (run && isActivePhase(run.phase)) return "waiting";
    if (readPending(deps)) return manual();
    quiet = 0;
    return autoTick(deps);
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

/**
 * A run that reached "restarting" is done if this server runs a newer build,
 * unless its runner is still alive: then it is checking this server and
 * will say how it ended.
 */
export function reconcileOnBoot(deps: RunDeps = realRunDeps()): void {
  const run = readRun(deps);
  if (!run || run.phase !== "restarting") return;
  if (run.updatedAt && pidAlive(run.pid)) return;
  const moved = deps.buildId() !== run.from;
  writeRun(deps.stateFile, {
    ...run,
    phase: moved ? "done" : "failed",
    outcome: moved ? "done" : "build_failed",
    finishedAt: deps.now(),
    ...(moved
      ? {}
      : {
          error:
            "The server restarted without the new build; see the update log.",
          log: readLog(deps),
        }),
  });
  recordFinishedRun(deps);
}
