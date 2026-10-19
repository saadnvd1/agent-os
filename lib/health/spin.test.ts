import { describe, expect, it } from "vitest";
import type { ProcRow } from "../process-table";
import {
  SPIN_WINDOW_MS,
  classifySpin,
  jobTree,
  killPlan,
  parseCpuTime,
  pickRoot,
  safeToKill,
  shellPids,
  spinNote,
  type SpinSample,
} from "./spin";
import { MIN } from "./types";
import { WAIT_ADVICE } from "../agents/brief";

const T0 = Date.parse("2026-10-14T18:00:00Z");

// One sample a minute for `minutes`, the shells using `cores` each interval.
const series = (
  minutes: number,
  cores: number,
  outputEvery?: number
): SpinSample[] =>
  Array.from({ length: minutes + 1 }, (_, i) => ({
    at: T0 + i * MIN,
    cpuSec: i * 60 * cores,
    outputAt: outputEvery && i ? T0 + i * MIN : null,
  }));

const proc = (pid: number, ppid: number, comm: string): ProcRow => ({
  pid,
  ppid,
  pcpu: 0,
  rss: 0,
  comm,
});

// worker (10) > claude (20) > zsh job (30) > children
const table = [
  proc(1, 0, "/sbin/launchd"),
  proc(10, 1, "node"),
  proc(20, 10, "/x/claude"),
  proc(30, 20, "/bin/zsh"),
  proc(31, 30, "/usr/bin/grep"),
  proc(32, 30, "sleep"),
  proc(40, 1, "tmux"),
];

describe("classifySpin", () => {
  it("calls a quiet loop on a core spinning once the window has passed", () => {
    expect(classifySpin(series(4, 0.95))).toBe("spinning");
  });

  it("waits for the window", () => {
    expect(classifySpin(series(3, 1))).toBe("warming");
    expect(classifySpin(series(0, 1))).toBe("warming");
  });

  it("leaves a job that sleeps between passes alone", () => {
    expect(classifySpin(series(8, 0.01))).toBe("sleeping");
  });

  it("leaves a busy job that keeps printing alone", () => {
    expect(classifySpin(series(6, 1, 1))).toBe("busy-with-output");
  });

  it("does not read a silent heavy build as a spin: its CPU is not in the shells", () => {
    // node and cc burn six cores, the shell around them almost none.
    expect(classifySpin(series(10, 0.02))).toBe("sleeping");
  });

  it("starts over after a gap in the samples", () => {
    const samples = [
      ...series(2, 1),
      ...series(2, 1).map((s) => ({ ...s, at: s.at + 20 * MIN })),
    ];
    expect(classifySpin(samples)).toBe("warming");
  });

  it("needs every interval of the window busy, and ignores older sleep", () => {
    const old = series(2, 0.01);
    const recent = series(5, 1).map((s, i) => ({
      ...s,
      at: T0 + (2 + i) * MIN,
      cpuSec: old[2].cpuSec + i * 60,
    }));
    expect(classifySpin([...old.slice(0, 2), ...recent])).toBe("spinning");
    const dip = series(6, 1);
    dip[4] = { ...dip[4], cpuSec: dip[3].cpuSec };
    expect(classifySpin(dip)).toBe("sleeping");
  });

  it("never counts CPU going backwards (a member exited)", () => {
    const s = series(6, 1);
    s[5] = { ...s[5], cpuSec: 0 };
    expect(classifySpin(s)).toBe("sleeping");
    expect(SPIN_WINDOW_MS).toBe(4 * MIN);
  });
});

describe("the job's processes", () => {
  it("finds the root among the holders of the output file", () => {
    expect(pickRoot([30, 31, 32], table)).toBe(30);
    expect(pickRoot([], table)).toBeNull();
  });

  it("walks the tree and finds its shells", () => {
    const tree = jobTree(30, table);
    expect(tree.map((r) => r.pid)).toEqual([30, 31, 32]);
    expect(shellPids(tree)).toEqual([30]);
  });

  it("stops the root first, then its children, by PID", () => {
    expect(killPlan(30, table)).toEqual([30, 31, 32]);
  });

  it("only stops a shell directly under the agent", () => {
    expect(safeToKill(30, table, [999])).toBe(true);
    expect(safeToKill(20, table, [999])).toBe(false); // the agent
    expect(safeToKill(10, table, [999])).toBe(false); // the worker
    expect(safeToKill(40, table, [999])).toBe(false); // tmux
    expect(safeToKill(1, table, [999])).toBe(false);
    expect(safeToKill(31, table, [999])).toBe(false); // not a shell
    expect(safeToKill(77, table, [999])).toBe(false); // unknown
  });

  it("refuses a tree that holds AgentOS or tmux", () => {
    const withServer = [...table, proc(50, 30, "tmux")];
    expect(safeToKill(30, withServer, [999])).toBe(false);
    expect(safeToKill(30, table, [32])).toBe(false);
  });
});

describe("parseCpuTime", () => {
  it("reads ps's formats", () => {
    expect(parseCpuTime("0:00.34")).toBeCloseTo(0.34);
    expect(parseCpuTime("12:34.50")).toBeCloseTo(754.5);
    expect(parseCpuTime("1:02:03")).toBe(3723);
    expect(parseCpuTime("2-01:00:00")).toBe(2 * 86400 + 3600);
    expect(parseCpuTime("nope")).toBeNull();
  });
});

describe("spinNote", () => {
  it("names the job and carries the wait advice", () => {
    const note = spinNote("wait for flightcheck", 30);
    expect(note).toContain("wait for flightcheck");
    expect(note).toContain("PID 30");
    expect(note).toContain(WAIT_ADVICE);
  });
});
