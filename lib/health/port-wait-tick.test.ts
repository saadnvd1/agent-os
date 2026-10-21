import { beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH_DEFAULTS, type HealthConfig } from "./config";
import {
  portWaitTick,
  resetPortWait,
  type PortWaitDeps,
} from "./port-wait-tick";
import type { ArgsProc, WaitSession } from "./port-wait";
import type { Listener } from "@/lib/ports";
import { MIN } from "./types";

const c = { ...HEALTH_DEFAULTS } as HealthConfig;
const LOOP = "until curl -sf localhost:3977; do sleep 5; done";
const session: WaitSession = {
  id: "pw-a",
  name: "fix-login",
  workspaceId: "w1",
  tmuxName: "aos-pw-a",
  worktree: "/w/pw-a",
};

function deps(over: {
  procs?: ArgsProc[] | null;
  listeners?: Listener[] | null;
}) {
  const d = {
    procs: async () =>
      over.procs === undefined
        ? [
            { pid: 10, ppid: 1, ageMs: 90 * MIN, args: "zsh" },
            { pid: 11, ppid: 10, ageMs: 62 * MIN, args: LOOP },
          ]
        : over.procs,
    panes: vi.fn(async () => [{ tmux: "aos-pw-a", pid: 10 }]),
    cwds: vi.fn(async () => new Map()),
    listeners: async () =>
      over.listeners === undefined
        ? [{ port: 3977, pid: 4121, command: "node", cwd: "/home/u/old" }]
        : over.listeners,
    portRows: () => ({
      sessions: [
        {
          id: "pw-a",
          name: "fix-login",
          project: "app",
          worktree: "/w/pw-a",
          ports: { PORT: 3107 },
          devServerPort: 3107,
        },
      ],
      devServers: [],
    }),
    sessions: () => [session],
    tell: vi.fn(async (_id: string, _body: string) => {}),
    event: vi.fn(
      (
        _ws: string,
        _key: string,
        _subject: string,
        _line: string,
        _now: number
      ) => {}
    ),
    record: vi.fn((_trip: unknown, _now: number) => {}),
  };
  return d satisfies PortWaitDeps;
}

beforeEach(resetPortWait);

describe("portWaitTick", () => {
  it("tells the agent and its orchestrator once about a wait on someone else's port", async () => {
    const d = deps({});
    await portWaitTick(Date.now(), c, d);
    await portWaitTick(Date.now(), c, d);
    expect(d.tell).toHaveBeenCalledTimes(1);
    expect(d.tell.mock.calls[0][0]).toBe("pw-a");
    expect(d.tell.mock.calls[0][1]).toContain(
      "held by pid 4121 (node) in /home/u/old, outside AgentOS"
    );
    expect(d.event).toHaveBeenCalledTimes(1);
    expect(d.event.mock.calls[0][0]).toBe("w1");
    expect(d.event.mock.calls[0][3]).toContain(
      "fix-login has waited 62 min for port 3977"
    );
    expect(d.record.mock.calls[0][0]).toMatchObject({
      check: "port-wait",
      subject: "pw-a:3977",
    });
  });

  it("tells it again when the holder changes", async () => {
    const d = deps({});
    await portWaitTick(Date.now(), c, d);
    d.listeners = async () => [
      { port: 3977, pid: 5000, command: "ruby", cwd: "/x" },
    ];
    await portWaitTick(Date.now(), c, d);
    expect(d.tell).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for a wait on its own server, a free port, a young loop or a machine it can't ask", async () => {
    for (const d of [
      deps({
        listeners: [
          { port: 3977, pid: 9, command: "node", cwd: "/w/pw-a/web" },
        ],
      }),
      deps({ listeners: [] }),
      deps({ listeners: null }),
      deps({ procs: [{ pid: 11, ppid: 1, ageMs: 2 * MIN, args: LOOP }] }),
      deps({ procs: null }),
    ]) {
      resetPortWait();
      await portWaitTick(Date.now(), c, d);
      expect(d.tell).not.toHaveBeenCalled();
      expect(d.event).not.toHaveBeenCalled();
    }
  });

  it("does no more I/O than ps when nothing waits on a port", async () => {
    const d = deps({
      procs: [{ pid: 11, ppid: 1, ageMs: 90 * MIN, args: "node server.js" }],
    });
    await portWaitTick(Date.now(), c, d);
    expect(d.panes).not.toHaveBeenCalled();
    expect(d.cwds).not.toHaveBeenCalled();
  });

  it("is off at 0 minutes", async () => {
    const d = deps({});
    await portWaitTick(Date.now(), { ...c, portWaitMinutes: 0 }, d);
    expect(d.tell).not.toHaveBeenCalled();
  });
});
