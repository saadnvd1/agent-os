import { describe, expect, it } from "vitest";
import {
  findPortWaits,
  parseEtime,
  parsePsArgs,
  portWaitNote,
  waitedPorts,
  type ArgsProc,
  type WaitSession,
} from "./port-wait";
import { MIN } from "./types";

describe("waitedPorts", () => {
  it.each([
    ["until curl -sf http://localhost:3000; do sleep 5; done", [3000]],
    ["while ! nc -z localhost 3000; do sleep 2; done", [3000]],
    ["until lsof -i :3000 -sTCP:LISTEN; do sleep 1; done", [3000]],
    ["while lsof -ti tcp:3000; do sleep 10; done", [3000]],
    [
      "until ss -ltn 'sport = :5173' | grep -q LISTEN; do sleep 1; done",
      [5173],
    ],
    ["npx wait-on tcp:4000", [4000]],
    ["until curl -s 127.0.0.1:8080/health; do sleep 1; done", [8080]],
  ])("%s", (args, ports) => {
    expect(waitedPorts(args)).toEqual(ports);
  });

  it("is nothing for a server, a one-off curl or a loop with no port", () => {
    expect(waitedPorts("node server.js --port 3000")).toEqual([]);
    expect(waitedPorts("curl -sf http://localhost:3000")).toEqual([]);
    expect(waitedPorts("until pgrep -x vite; do sleep 1; done")).toEqual([]);
  });
});

describe("ps parsing", () => {
  it("reads etime in every form", () => {
    expect(parseEtime("05:03")).toBe(303);
    expect(parseEtime("01:00:00")).toBe(3600);
    expect(parseEtime("2-03:00:01")).toBe(2 * 86400 + 3 * 3600 + 1);
    expect(parseEtime("x")).toBeNull();
  });

  it("keeps args with their spaces", () => {
    expect(
      parsePsArgs("  41  1 12:00 bash -c until curl x; do sleep 1; done\n")
    ).toEqual([
      {
        pid: 41,
        ppid: 1,
        ageMs: 720_000,
        args: "bash -c until curl x; do sleep 1; done",
      },
    ]);
  });
});

const LOOP = "until curl -sf localhost:3000; do sleep 5; done";
const sessions: WaitSession[] = [
  {
    id: "a",
    name: "fix-login",
    workspaceId: "w",
    tmuxName: "aos-a",
    worktree: "/w/a",
  },
  {
    id: "b",
    name: "chat-task",
    workspaceId: "w",
    tmuxName: null,
    worktree: "/w/b",
  },
];
const proc = (
  pid: number,
  ppid: number,
  mins: number,
  args = LOOP
): ArgsProc => ({
  pid,
  ppid,
  ageMs: mins * MIN,
  args,
});

describe("findPortWaits", () => {
  it("gives a terminal session its loop through the pane, and a chat session its loop by cwd", () => {
    const procs = [proc(10, 1, 60, "zsh"), proc(11, 10, 30), proc(20, 1, 15)];
    const waits = findPortWaits(
      procs,
      sessions,
      [{ tmux: "aos-a", pid: 10 }],
      new Map([[20, "/w/b/web"]]),
      10 * MIN
    );
    expect(waits.map((w) => [w.sessionId, w.pid, w.port])).toEqual([
      ["a", 11, 3000],
      ["b", 20, 3000],
    ]);
  });

  it("folds a loop's wrapper shells into one wait, and skips young or unowned ones", () => {
    const procs = [
      proc(10, 1, 60, "zsh"),
      proc(11, 10, 30, `bash -c ${LOOP}`),
      proc(12, 11, 30),
      proc(13, 10, 2, "until curl localhost:4000; do sleep 1; done"),
      proc(99, 1, 60),
    ];
    const waits = findPortWaits(
      procs,
      sessions,
      [{ tmux: "aos-a", pid: 10 }],
      new Map(),
      10 * MIN
    );
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({ sessionId: "a", port: 3000 });
  });
});

describe("portWaitNote", () => {
  it("names the holder, the agent's own job and port, and the way out", () => {
    const note = portWaitNote(
      {
        sessionId: "a",
        sessionName: "fix-login",
        workspaceId: "w",
        pid: 11,
        port: 3000,
        args: LOOP,
        waitedMs: 62 * MIN,
      },
      'session "old" (project app), pid 9',
      { PORT: 3107 }
    );
    expect(note).toContain("You've waited 62 min for port 3000");
    expect(note).toContain('held by session "old" (project app), pid 9');
    expect(note).toContain("`kill 11`");
    expect(note).toContain("`aos port 3000`");
    expect(note).toContain("Your ports are PORT=3107.");
    expect(note).toContain("tell the orchestrator");
  });
});
