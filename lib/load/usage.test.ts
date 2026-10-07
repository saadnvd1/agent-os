import { describe, expect, it } from "vitest";
import { parsePanes, parsePs, sumTrees } from "./usage";

// tmux server (10) -> two panes' shells (20, 30); 20 runs claude (21), which
// runs vitest (22) with a worker (23). 99 belongs to no session.
const PS = `
    1     0   0.0   1024
   10     1   0.1   2048
   20    10   0.0   1024
   21    20  45.5 409600
   22    21 180.0 1048576
   23    22  90.0 524288
   30    10   0.0   1024
   31    30  12.0  65536
   99     1 300.0 999999
garbage line
`;

describe("per-session usage", () => {
  it("parses ps and tmux output", () => {
    expect(parsePs(PS)).toHaveLength(9);
    expect(parsePs(PS)[3]).toEqual({
      pid: 21,
      ppid: 20,
      pcpu: 45.5,
      rss: 409600,
    });
    expect(parsePanes("task-a\t20\ntask-b\t30\n\nbad\n")).toEqual([
      { tmux: "task-a", pid: 20 },
      { tmux: "task-b", pid: 30 },
    ]);
  });

  it("sums each pane's whole process tree", () => {
    const usage = sumTrees(parsePs(PS), [
      { key: "task-a", pid: 20 },
      { key: "task-b", pid: 30 },
    ]);
    expect(usage["task-a"].cores).toBeCloseTo(3.155);
    expect(usage["task-a"].rssBytes).toBe(
      (1024 + 409600 + 1048576 + 524288) * 1024
    );
    expect(usage["task-b"].cores).toBeCloseTo(0.12);
  });

  it("counts a process once, and a pane that's gone as nothing", () => {
    const usage = sumTrees(parsePs(PS), [
      { key: "a", pid: 21 },
      { key: "b", pid: 20 },
      { key: "gone", pid: 12345 },
    ]);
    expect(usage.a.cores).toBeCloseTo(3.155);
    expect(usage.b.cores).toBe(0);
    expect(usage.gone).toEqual({ cores: 0, rssBytes: 0 });
  });
});
