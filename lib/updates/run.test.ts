import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateRun } from "./banner";
import type { CheckResult } from "./check";
import { tempDir } from "@/lib/test-temp";

// startUpdate asks for a fresh check; here it's whatever the test says.
let check: CheckResult;
vi.mock("./check", async (orig) => ({
  ...(await orig<typeof import("./check")>()),
  checkForUpdate: async () => ({ result: check }),
  cachedCheck: () => check,
  reconcile: async (c: CheckResult) => c,
  versionAt: async (_g: unknown, sha: string) => ({
    sha,
    version: `v-${sha}`,
  }),
}));

const run = await import("./run");

let dir: string;
let now: number;
let spawned: { env: NodeJS.ProcessEnv; log: string }[];
let settings: Map<string, string>;
let porcelain: string;
let branch: string;
let working: { sessions: number; reviews: number; setups: number };
let lock: boolean;
let env: Record<string, string | undefined>;
let restart: string | null;
let free: number | null;
let managed: boolean;
let busyNow: string[];
let notified: string[];

const deps = (): import("./run").RunDeps => ({
  cwd: dir,
  env,
  git: async (args) => {
    if (args[0] === "status") return porcelain;
    if (args[0] === "branch") return `${branch}\n`;
    return ".git\n";
  },
  check: {} as never,
  now: () => now,
  stateFile: path.join(dir, "state.json"),
  logFile: path.join(dir, "update.log"),
  lockHeld: () => lock,
  restartCommand: async () => restart,
  spawnRunner: (e, log) => spawned.push({ env: e, log }),
  buildId: () => "newsha",
  working: async () => working,
  getSetting: (k) => settings.get(k) ?? null,
  putSetting: (k, v) =>
    void (v === null ? settings.delete(k) : settings.set(k, v)),
  freeBytes: () => free,
  managed: () => managed,
  busy: async () => busyNow,
  dbFile: null,
  backupDir: null,
  notify: (text) => void notified.push(text),
});

const available = (): CheckResult => ({
  status: "ok",
  current: { version: "0.3.1", sha: "oldsha" },
  latest: { version: "0.3.5", sha: "newsha", notes: ["a"], url: null },
  behind: 4,
  available: true,
  branch: "main",
  checkedAt: 1,
  error: null,
});

const state = (): UpdateRun =>
  JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));

beforeEach(() => {
  dir = tempDir("aos-run-");
  now = 1_000_000;
  spawned = [];
  settings = new Map();
  porcelain = "";
  branch = "main";
  working = { sessions: 0, reviews: 0, setups: 0 };
  lock = false;
  env = { PORT: "3111", AGENTOS_BUILD: "stale" };
  restart = "restart-cmd";
  free = null;
  managed = false;
  busyNow = [];
  notified = [];
  check = available();
  run.resetAutoMemory();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("startUpdate refusals", () => {
  const refused = async (when: "now" | "idle" = "now") => {
    const r = await run.startUpdate({ when }, deps());
    expect(spawned).toHaveLength(0);
    expect(settings.size).toBe(0);
    return r;
  };

  it("refuses on a dev server", async () => {
    env.AGENTOS_DEV = "1";
    expect(await refused()).toMatchObject({ ok: false, code: "dev" });
  });

  it("refuses when the checkout has local changes, naming the files", async () => {
    porcelain = " M lib/a.ts\n M lib/b.ts\n";
    const r = await refused();
    expect(r).toMatchObject({ ok: false, code: "dirty" });
    expect(r.ok === false && r.error).toContain("lib/a.ts, lib/b.ts");
  });

  it("refuses off the default branch, when diverged, and when up to date", async () => {
    branch = "feature";
    expect(await refused()).toMatchObject({ code: "branch" });
    branch = "main";
    check = { ...available(), status: "diverged", available: false };
    expect(await refused()).toMatchObject({ code: "diverged" });
    check = { ...available(), available: false, behind: 0 };
    expect(await refused()).toMatchObject({ code: "up_to_date" });
  });

  it("refuses when the check itself failed", async () => {
    check = {
      ...available(),
      status: "unknown",
      available: false,
      error: "offline",
    };
    const r = await refused();
    expect(r).toMatchObject({ code: "unknown" });
    expect(r.ok === false && r.error).toContain("offline");
  });

  it("refuses while another update runs or a build holds the lock", async () => {
    lock = true;
    expect(await refused()).toMatchObject({ code: "building" });
    lock = false;
    run.writeRun(deps().stateFile, {
      id: "x",
      phase: "building",
      from: "a",
      fromVersion: "1",
      toVersion: "2",
      startedAt: now - 1000,
    });
    expect(await refused()).toMatchObject({ code: "running" });
  });

  it("does not count an old stuck run as running", async () => {
    run.writeRun(deps().stateFile, {
      id: "x",
      phase: "building",
      from: "a",
      fromVersion: "1",
      toVersion: "2",
      startedAt: now - run.STALE_RUN_MS - 1,
    });
    expect(await run.startUpdate({ when: "now" }, deps())).toMatchObject({
      ok: true,
    });
  });
});

describe("startUpdate", () => {
  it("starts the runner detached with the restart command, and a clean build id", async () => {
    expect(await run.startUpdate({ when: "now" }, deps())).toEqual({
      ok: true,
      pending: false,
    });
    expect(spawned).toHaveLength(1);
    const { env: e } = spawned[0];
    expect(e.AGENTOS_RESTART).toBe("restart-cmd");
    expect(e.PORT).toBe("3111");
    expect(e.AGENTOS_BUILD).toBeUndefined();
    expect(e.AGENTOS_UPDATE_STATE).toBe(path.join(dir, "state.json"));
    expect(state()).toMatchObject({
      phase: "starting",
      from: "oldsha",
      fromVersion: "0.3.1",
      toVersion: "0.3.5",
    });
  });

  it("without a restart command it refuses and spawns nothing", async () => {
    restart = null;
    const r = await run.startUpdate({ when: "now" }, deps());
    expect(r).toMatchObject({ ok: false, code: "no_restart" });
    expect(r.ok === false && r.error).toContain("AGENTOS_RESTART");
    expect(spawned).toHaveLength(0);
    expect(settings.size).toBe(0);
    expect(fs.existsSync(path.join(dir, "state.json"))).toBe(false);
  });

  it("'idle' only records the request", async () => {
    expect(await run.startUpdate({ when: "idle" }, deps())).toEqual({
      ok: true,
      pending: true,
    });
    expect(spawned).toHaveLength(0);
    expect(run.readPending(deps())).toMatchObject({ requestedAt: now });
    run.cancelPending(deps());
    expect(run.readPending(deps())).toBeNull();
  });
});

describe("resolveRestart", () => {
  it("prefers AGENTOS_RESTART, then the CLI, else nothing", async () => {
    expect(
      await run.resolveRestart(
        "/r",
        { AGENTOS_RESTART: "sm restart x" },
        async () => true
      )
    ).toBe("sm restart x");
    expect(await run.resolveRestart("/r", {}, async () => true)).toBe(
      "'/r/scripts/agent-os' restart"
    );
    expect(await run.resolveRestart("/r", {}, async () => false)).toBeNull();
    // A systemd unit from before KillMode=process would take the update down with it.
    expect(
      await run.resolveRestart(
        "/r",
        {},
        async () => true,
        () => false
      )
    ).toBeNull();
  });
});

describe("update when idle", () => {
  it("waits while anything works, starts after two quiet checks", async () => {
    await run.startUpdate({ when: "idle" }, deps());
    const watcher = run.createIdleWatcher(deps());
    working = { sessions: 1, reviews: 0, setups: 0 };
    expect(await watcher.tick()).toBe("waiting");
    working = { sessions: 0, reviews: 1, setups: 0 };
    expect(await watcher.tick()).toBe("waiting");
    working = { sessions: 0, reviews: 0, setups: 0 };
    expect(await watcher.tick()).toBe("waiting");
    expect(spawned).toHaveLength(0);
    expect(await watcher.tick()).toBe("started");
    expect(spawned).toHaveLength(1);
    expect(run.readPending(deps())).toBeNull();
  });

  it("does nothing without a request, and a request expires after a day", async () => {
    const watcher = run.createIdleWatcher(deps());
    expect(await watcher.tick()).toBe("none");
    await run.startUpdate({ when: "idle" }, deps());
    now += run.PENDING_EXPIRES_MS + 1;
    expect(run.readPending(deps())).toBeNull();
    expect(await watcher.tick()).toBe("none");
  });

  it("shows a refusal at start time as a failed run", async () => {
    await run.startUpdate({ when: "idle" }, deps());
    porcelain = " M lib/a.ts\n";
    const watcher = run.createIdleWatcher(deps());
    await watcher.tick();
    await watcher.tick();
    expect(state()).toMatchObject({ phase: "failed" });
    expect(state().error).toContain("local changes");
    expect(run.readPending(deps())).toBeNull();
  });

  it("starts one runner when two starts race", async () => {
    const [a, b] = await Promise.all([
      run.startUpdate({ when: "now" }, deps()),
      run.startUpdate({ when: "now" }, deps()),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(spawned).toHaveLength(1);
  });

  it("refuses when the fresh look failed", async () => {
    check = { ...check, error: "network down" };
    const r = await run.startUpdate({ when: "now" }, deps());
    expect(r).toMatchObject({ ok: false, code: "unknown" });
    expect(spawned).toHaveLength(0);
  });
});

describe("reconcileOnBoot", () => {
  const write = (phase: UpdateRun["phase"], from: string) =>
    run.writeRun(deps().stateFile, {
      id: "x",
      phase,
      from,
      fromVersion: "1",
      toVersion: "2",
      startedAt: now,
    });

  it("a restart onto a new build finishes the run", () => {
    write("restarting", "oldsha");
    run.reconcileOnBoot(deps());
    expect(state().phase).toBe("done");
  });

  it("a restart onto the same build fails it", () => {
    write("restarting", "newsha");
    run.reconcileOnBoot(deps());
    expect(state()).toMatchObject({ phase: "failed" });
  });

  it("leaves a run that is still building alone", () => {
    write("building", "oldsha");
    run.reconcileOnBoot(deps());
    expect(state().phase).toBe("building");
  });
});

describe("automatic updates", () => {
  const H = 60 * 60_000;
  const soaked = (sha = "newsha", age = 3 * H) => ({ sha, at: now - age });
  const tickFor = async (
    watcher: ReturnType<typeof run.createIdleWatcher>,
    ms: number
  ) => {
    let last = "";
    for (let t = 0; t <= ms; t += 30_000) {
      last = await watcher.tick();
      now += 30_000;
      if (last === "started") break;
    }
    return last;
  };

  beforeEach(() => {
    check = { ...available(), candidates: [soaked()] };
  });

  it("starts once everything has been idle for the idle time, pinned to the target", async () => {
    const watcher = run.createIdleWatcher(deps());
    expect(await watcher.tick()).toBe("waiting");
    now += 9 * 60_000;
    expect(await watcher.tick()).toBe("waiting");
    now += 60_000;
    expect(await watcher.tick()).toBe("started");
    expect(spawned).toHaveLength(1);
    expect(spawned[0].env.AGENTOS_UPDATE_TO).toBe("newsha");
    expect(state()).toMatchObject({
      auto: true,
      to: "newsha",
      phase: "starting",
    });
  });

  it("follows the idle-minutes setting", async () => {
    settings.set("updates.autoIdleMinutes", "30");
    const watcher = run.createIdleWatcher(deps());
    expect(await tickFor(watcher, 20 * 60_000)).toBe("waiting");
    expect(await tickFor(watcher, 11 * 60_000)).toBe("started");
  });

  it("never starts while something is working, and quiet starts over after it", async () => {
    const watcher = run.createIdleWatcher(deps());
    busyNow = ["1 session working"];
    expect(await tickFor(watcher, 4 * H)).toBe("waiting");
    busyNow = [];
    expect(await tickFor(watcher, 8 * 60_000)).toBe("waiting");
    busyNow = ["1 merge"];
    await watcher.tick();
    busyNow = [];
    expect(await tickFor(watcher, 8 * 60_000)).toBe("waiting");
    expect(spawned).toHaveLength(0);
  });

  it("takes the newest commit that has soaked, not a fresh head", async () => {
    check = {
      ...available(),
      candidates: [soaked("fresh", 10 * 60_000), soaked("older", 3 * H)],
    };
    const watcher = run.createIdleWatcher(deps());
    expect(await tickFor(watcher, 11 * 60_000)).toBe("started");
    expect(spawned[0].env.AGENTOS_UPDATE_TO).toBe("older");
    expect(state().toVersion).toBe("v-older");
  });

  it("does nothing when off, pinned off, or deployed by autodeploy", async () => {
    settings.set("updates.auto", "0");
    expect(await tickFor(run.createIdleWatcher(deps()), H)).toBe("none");
    settings.delete("updates.auto");
    env.AGENTOS_AUTO_UPDATE = "off";
    expect(await tickFor(run.createIdleWatcher(deps()), H)).toBe("none");
    delete env.AGENTOS_AUTO_UPDATE;
    managed = true;
    expect(await tickFor(run.createIdleWatcher(deps()), H)).toBe("none");
    expect(spawned).toHaveLength(0);
  });

  it("a refused install skips quietly: no failed run, and the reason in the view", async () => {
    porcelain = " M lib/a.ts\n";
    const watcher = run.createIdleWatcher(deps());
    // Refused once, then left alone instead of asking every tick.
    expect(await tickFor(watcher, 15 * 60_000)).toBe("none");
    expect(spawned).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "state.json"))).toBe(false);
    const view = await run.autoView(deps(), check, null);
    expect(view.status?.code).toBe("refused");
    expect(view.status?.text).toContain("local changes");
  });

  it("refuses when the disk is nearly full", async () => {
    free = 1024 ** 3;
    const r = await run.startUpdate({ when: "now" }, deps());
    expect(r).toMatchObject({ ok: false, code: "disk" });
    expect(spawned).toHaveLength(0);
  });

  it("files a finished run once and tells the phone when it broke", () => {
    run.writeRun(deps().stateFile, {
      id: "b1",
      phase: "failed",
      outcome: "broken",
      auto: true,
      from: "oldsha",
      to: "newsha",
      fromVersion: "0.3.1",
      toVersion: "0.3.5",
      startedAt: now,
      finishedAt: now,
    });
    run.recordFinishedRun(deps());
    run.recordFinishedRun(deps());
    expect(JSON.parse(settings.get("updates.attempts")!)).toHaveLength(1);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("0.3.5");
  });

  it("won't take a commit that was rolled back, until a newer one soaks", async () => {
    settings.set(
      "updates.attempts",
      JSON.stringify([
        {
          id: "r",
          from: "oldsha",
          to: "newsha",
          fromVersion: "",
          toVersion: "",
          auto: true,
          startedAt: now,
          finishedAt: now,
          outcome: "rolled_back",
        },
      ])
    );
    const watcher = run.createIdleWatcher(deps());
    expect(await tickFor(watcher, H)).toBe("none");
    check = { ...available(), candidates: [soaked("newer"), soaked()] };
    expect(await tickFor(watcher, 11 * 60_000)).toBe("started");
    expect(spawned[0].env.AGENTOS_UPDATE_TO).toBe("newer");
  });
});

describe("run heartbeat", () => {
  it("a run whose runner stopped writing and is gone reads as failed", () => {
    run.writeRun(deps().stateFile, {
      id: "h",
      phase: "building",
      from: "a",
      fromVersion: "1",
      toVersion: "2",
      startedAt: now - 5 * 60_000,
      updatedAt: now - 3 * 60_000,
      pid: 2 ** 22 + 12345,
    });
    expect(run.readRun(deps())?.phase).toBe("failed");
  });

  it("a slow run with a live runner is still running, however long it takes", () => {
    run.writeRun(deps().stateFile, {
      id: "h",
      phase: "restarting",
      from: "oldsha",
      fromVersion: "1",
      toVersion: "2",
      startedAt: now - 60 * 60_000,
      updatedAt: now - 3 * 60_000,
      pid: process.pid,
    });
    expect(run.readRun(deps())?.phase).toBe("restarting");
    // Its runner is checking the new server; the boot leaves it alone.
    run.reconcileOnBoot(deps());
    expect(state().phase).toBe("restarting");
  });
});
