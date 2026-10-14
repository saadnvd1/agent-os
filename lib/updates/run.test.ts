import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateRun } from "./banner";
import type { CheckResult } from "./check";

// startUpdate asks for a fresh check; here it's whatever the test says.
let check: CheckResult;
vi.mock("./check", async (orig) => ({
  ...(await orig<typeof import("./check")>()),
  checkForUpdate: async () => ({ result: check }),
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-run-"));
  now = 1_000_000;
  spawned = [];
  settings = new Map();
  porcelain = "";
  branch = "main";
  working = { sessions: 0, reviews: 0, setups: 0 };
  lock = false;
  env = { PORT: "3111", AGENTOS_BUILD: "stale" };
  restart = "restart-cmd";
  check = available();
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

  it("without a restart command it still builds, and says so at the end", async () => {
    restart = null;
    await run.startUpdate({ when: "now" }, deps());
    expect(spawned[0].env.AGENTOS_RESTART).toBeUndefined();
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
