import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcRow } from "../process-table";
import { KILL_GRACE_MS } from "./spin";
import { parseHolders, resetSpin, spinTick, type SpinDeps } from "./spin-tick";
import type { BgTask } from "./facts";
import { MIN } from "./types";

const T0 = Date.parse("2026-10-14T18:00:00Z");
const proc = (pid: number, ppid: number, comm: string): ProcRow => ({
  pid,
  ppid,
  pcpu: 0,
  rss: 0,
  comm,
});

const base = [
  proc(1, 0, "/sbin/launchd"),
  proc(10, 1, "node"),
  proc(20, 10, "/x/claude"),
  proc(40, 1, "tmux"),
];
const job = [proc(30, 20, "/bin/zsh"), proc(31, 30, "grep")];

const task = (over: Partial<BgTask> = {}): BgTask => ({
  sessionId: "s1",
  sessionName: "stuck-task",
  workspaceId: "ws1",
  taskId: "t1",
  description: "wait for flightcheck",
  startedAt: T0 - 10 * MIN,
  outputAt: null,
  outputFile: "/tmp/t1.output",
  taskType: "local_bash",
  ...over,
});

function setup(opts: {
  cores?: number;
  table?: () => ProcRow[];
  tasks?: BgTask[];
  outputEvery?: boolean;
}) {
  let now = T0;
  let alive = [...base, ...job];
  const killed: [number, string][] = [];
  const told: string[] = [];
  const events: string[] = [];
  const recorded: string[] = [];
  const cores = opts.cores ?? 1;
  const deps: SpinDeps = {
    tasks: () =>
      (opts.tasks ?? [task()]).map((t) => ({
        ...t,
        outputAt: opts.outputEvery ? now : null,
      })),
    holders: vi.fn(async () => new Map([["/tmp/t1.output", [30, 31]]])),
    table: vi.fn(async () => opts.table?.() ?? alive),
    cpuSeconds: async () => new Map([[30, ((now - T0) / 1000) * cores]]),
    kill: (pid, sig) => {
      killed.push([pid, sig]);
    },
    sleep: async (ms) => {
      expect(ms).toBe(KILL_GRACE_MS);
    },
    tell: async (_s, body) => {
      told.push(body);
    },
    event: (_w, key, _sub, line) => {
      events.push(`${key}|${line}`);
    },
    record: (t) => {
      recorded.push(t.check);
    },
  };
  const tick = async (minutes: number) => {
    for (let i = 0; i <= minutes; i++) {
      now = T0 + i * MIN;
      await spinTick(now, deps);
    }
  };
  return {
    deps,
    tick,
    killed,
    told,
    events,
    recorded,
    setAlive: (t: ProcRow[]) => (alive = t),
  };
}

describe("spinTick", () => {
  beforeEach(() => {
    resetSpin();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("stops a spinning job by PID: root then children, SIGTERM then SIGKILL for survivors", async () => {
    const s = setup({});
    await s.tick(4);
    expect(s.killed.slice(0, 2)).toEqual([
      [30, "SIGTERM"],
      [31, "SIGTERM"],
    ]);
    // Both are still the same processes after the grace.
    expect(s.killed.slice(2)).toEqual([
      [30, "SIGKILL"],
      [31, "SIGKILL"],
    ]);
    for (const [pid] of s.killed) {
      expect(Number.isInteger(pid) && pid > 1).toBe(true);
      expect([10, 20, 40, process.pid, process.ppid]).not.toContain(pid);
    }
  });

  it("does not SIGKILL a process that exited or whose PID was reused", async () => {
    const sent: unknown[] = [];
    const s = setup({
      // After the SIGTERMs: 30 is gone, 31's number is someone else's now.
      table: () =>
        sent.length
          ? [...base, proc(31, 1, "/usr/bin/vim")]
          : [...base, ...job],
    });
    s.deps.kill = (pid, sig) => {
      sent.push(pid);
      s.killed.push([pid, sig]);
    };
    await s.tick(4);
    expect(s.killed).toEqual([
      [30, "SIGTERM"],
      [31, "SIGTERM"],
    ]);
  });

  it("tells the task, the orchestrator and the history once", async () => {
    const s = setup({});
    await s.tick(6);
    expect(s.told).toHaveLength(1);
    expect(s.told[0]).toContain("wait for flightcheck");
    expect(s.told[0]).toContain("run_in_background");
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toContain("bg-spin:s1:t1");
    expect(s.events[0]).toContain("<untrusted");
    expect(s.recorded).toEqual(["bg-spin"]);
  });

  it("leaves a job that sleeps alone", async () => {
    const s = setup({ cores: 0.01 });
    await s.tick(10);
    expect(s.killed).toEqual([]);
  });

  it("leaves a busy job that keeps printing alone", async () => {
    const s = setup({ cores: 1, outputEvery: true });
    await s.tick(10);
    expect(s.killed).toEqual([]);
  });

  it("leaves a silent heavy build alone: its CPU is not in the shell", async () => {
    const s = setup({ cores: 0.02 });
    await s.tick(10);
    expect(s.killed).toEqual([]);
  });

  it("will not stop anything that is not a plain job of the agent", async () => {
    const s = setup({});
    // The job's parent is tmux, not the agent.
    s.setAlive([...base, proc(30, 40, "/bin/zsh"), proc(31, 30, "grep")]);
    await s.tick(5);
    expect(s.killed).toEqual([]);
    expect(s.told).toEqual([]);
  });

  it("does no process I/O without a background job, or for a subagent task", async () => {
    const none = setup({ tasks: [] });
    await none.tick(2);
    expect(none.deps.table).not.toHaveBeenCalled();
    expect(none.deps.holders).not.toHaveBeenCalled();
    resetSpin();
    const sub = setup({ tasks: [task({ taskType: "local_agent" })] });
    await sub.tick(2);
    expect(sub.deps.table).not.toHaveBeenCalled();
  });
});

describe("parseHolders", () => {
  it("maps files to the PIDs holding them", () => {
    const out = "p30\nn/tmp/a.output\np31\nn/tmp/a.output\nn/tmp/b\n";
    expect(parseHolders(out)).toEqual(
      new Map([
        ["/tmp/a.output", [30, 31]],
        ["/tmp/b", [31]],
      ])
    );
  });
});
