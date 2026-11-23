import { describe, expect, it, vi } from "vitest";
import { pickProcesses } from "./pick";
import { sweepStrayProcesses } from "./sweep";
import { stopWorktreeProcesses } from "./stop";
import type { Proc } from "./types";

const WT = "/home/u/.agent-os/worktrees/rails-ab12";
const p = (pid: number, o: Partial<Proc> = {}): Proc => ({
  pid,
  ppid: 1,
  pgid: pid,
  cwd: "/",
  command: "sleep 1",
  ...o,
});

const procs: Proc[] = [
  p(10, { command: "node server.js", cwd: "/home/u/agentos" }), // the server
  p(11, { ppid: 10, command: "tmux -S /x new-session", cwd: WT }),
  p(100, { command: "foreman start", cwd: WT, pgid: 100 }),
  p(101, { ppid: 100, pgid: 100, command: "puma", cwd: `${WT}/app` }),
  p(102, { ppid: 100, pgid: 100, command: "vite", cwd: "/" }),
  p(103, { command: `node ${WT}/bin/vite.js`, cwd: "/" }),
  p(104, { command: "ruby", cwd: `${WT}-other` }),
  p(105, { command: "ruby", cwd: "/home/u/other-project" }),
  p(106, { command: "ruby", cwd: `${WT} (deleted)` }),
  p(107, { command: `cat ${WT}-other/file`, cwd: "/" }),
  p(108, { command: "node", cwd: "/" }),
];

const ids = (picked: { pid: number }[]) => picked.map((x) => x.pid).sort();

describe("picking a worktree's processes", () => {
  it("takes what runs inside it or names it, nothing outside", () => {
    const got = pickProcesses({ procs, worktree: WT, serverPids: [10] });
    expect(ids(got)).toEqual([100, 101, 103, 106]);
  });

  it("takes the holder of a port the task was given", () => {
    const got = pickProcesses({
      procs,
      worktree: WT,
      portHolders: [108, 105],
      serverPids: [10],
    });
    expect(ids(got)).toEqual([100, 101, 103, 105, 106, 108]);
  });

  it("never takes the server, its ancestors or a tmux, even in the worktree", () => {
    const all = procs.map((x) => ({ ...x, cwd: WT }));
    const chain = [
      p(1, { cwd: WT }),
      p(5, { ppid: 1, cwd: WT }),
      ...all.map((x) => (x.pid === 10 ? { ...x, ppid: 5 } : x)),
    ];
    const got = pickProcesses({
      procs: chain,
      worktree: WT,
      portHolders: [10, 5],
      serverPids: [10],
    });
    expect(ids(got)).not.toContain(10);
    expect(ids(got)).not.toContain(5);
    expect(ids(got)).not.toContain(1);
    expect(ids(got)).not.toContain(11);
  });

  it("signals the group only when it holds no server or tmux", () => {
    const shared = [
      p(10, { pgid: 50 }),
      p(60, { pgid: 50, cwd: WT, command: "puma" }),
      p(70, { pgid: 70, cwd: WT, command: "vite" }),
    ];
    const got = pickProcesses({
      procs: shared,
      worktree: WT,
      serverPids: [10],
    });
    expect(got.find((x) => x.pid === 60)?.group).toBe(false);
    expect(got.find((x) => x.pid === 70)?.group).toBe(true);
  });
});

describe("stopping them", () => {
  it("sends TERM to the group, then KILL to what survives", async () => {
    const kill = vi.fn();
    let alive = true;
    const stopped = await stopWorktreeProcesses(WT, [3000], {
      list: async () => [procs[0], procs[2], procs[3]],
      holders: async () => [],
      serverPids: () => [10],
      kill,
      alive: () => alive,
      sleep: async () => {
        alive = true;
      },
      graceMs: 0,
    });
    expect(kill).toHaveBeenNthCalledWith(1, -100, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-100, "SIGKILL");
    expect(stopped.map((s) => s.pid)).toEqual([100, 101]);
  });

  it("does not wait or kill when nothing matches", async () => {
    const kill = vi.fn();
    const out = await stopWorktreeProcesses("/elsewhere", [], {
      list: async () => procs,
      serverPids: () => [10],
      kill,
    });
    expect(out).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });
});

describe("the sweep", () => {
  const root = "/home/u/.agent-os/worktrees";
  it("stops processes of a worktree that is gone, leaves live ones", async () => {
    const kill = vi.fn();
    const list = [
      p(10, { cwd: "/home/u/agentos" }),
      p(200, { cwd: `${root}/dead-1/app`, command: "puma", pgid: 200 }),
      p(201, { cwd: "/", command: `node ${root}/dead-1/x.js`, pgid: 201 }),
      p(300, { cwd: `${root}/live-1`, command: "puma", pgid: 300 }),
      p(400, { cwd: "/home/u/proj", command: "puma" }),
    ];
    const stopped = await sweepStrayProcesses(
      {
        list: async () => list,
        serverPids: () => [10],
        kill,
        alive: () => false,
        graceMs: 0,
      },
      root,
      (w) => w.endsWith("live-1")
    );
    expect(stopped.map((s) => s.pid).sort()).toEqual([200, 201]);
    expect(kill).toHaveBeenCalledWith(-200, "SIGTERM");
    expect(kill).not.toHaveBeenCalledWith(-300, expect.anything());
    expect(kill).not.toHaveBeenCalledWith(-10, expect.anything());
  });
});
