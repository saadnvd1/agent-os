import { describe, expect, it } from "vitest";
import { parsePsTable } from "../process-table";
import {
  attributeLoad,
  claimSessions,
  cwdCandidates,
  matchSession,
  parseLsofCwd,
  sessionPaths,
  type SessionRow,
} from "./attribute";

const row = (id: string, extra: Partial<SessionRow> = {}): SessionRow => ({
  id,
  name: id,
  tmux_name: `claude-${id}`,
  worktree_path: `/w/${id}`,
  working_directory: `/w/${id}`,
  ...extra,
});
const rows = [row("a"), row("b")];
const panes = [
  { tmux: "claude-a", pid: 20 },
  { tmux: "claude-b", pid: 30 },
];
const HOME = "/home/u";

// pid ppid pcpu rss comm. Pane a (20) -> claude (21) -> bash (22) ->
// xcodebuild (23, 8 cores) -> clang (24). Pane b is idle. 50 is a build
// service reparented to init, working in a's worktree, with workers 51, 52.
// 60 is autodeploy's npm, 61 and 62 are orphaned clangs, in nobody's.
const PS = `
    1     0   0.0   1024 /sbin/init
   10     1   0.1   2048 tmux
   20    10   0.0   1024 -zsh
   21    20   5.0 409600 claude
   22    21   0.0   1024 bash
   23    22 800.0 524288 xcodebuild
   24    23  10.0  65536 clang
   30    10   0.0   1024 -zsh
   31    30  10.0  65536 claude
   50     1  20.0 100000 XCBBuildService
   51    50 300.0 100000 clang
   52    50 200.0 100000 clang
   60     1 300.0 999999 npm
   61     1  40.0 100000 clang
   62     1  40.0 100000 clang
`;
const procs = parsePsTable(PS);
const owner = claimSessions(procs, panes, rows);
const run = (cwds: [number, string][] = []) =>
  attributeLoad({ procs, owner, rows, cwds: new Map(cwds), home: HOME });

describe("load attribution", () => {
  it("counts a task's child build at its full cores", () => {
    const { sessions } = run();
    expect(sessions.a.cores).toBeCloseTo(8.15, 0);
    expect(sessions.a.rssBytes).toBe(
      (1024 + 409600 + 1024 + 524288 + 65536) * 1024
    );
    expect(sessions.b.cores).toBe(0.1);
  });

  it("places a reparented build, and its workers, by cwd", () => {
    const { sessions, unattributed } = run([
      [50, "/w/a/ios/build"],
      [60, "/srv/other"],
    ]);
    // 8.15 in the tree + 0.2 + 3 + 2 reparented.
    expect(sessions.a.cores).toBe(13.4);
    expect(unattributed.map((g) => g.name)).not.toContain("XCBBuildService");
    expect(unattributed.find((g) => g.name === "clang")?.count).toBe(2);
  });

  it("places a lone orphan by its own cwd", () => {
    const { sessions } = run([[61, "/w/b"]]);
    expect(sessions.b.cores).toBe(0.5);
  });

  it("reports heavy processes of no session as unattributed", () => {
    const { sessions, unattributed } = run([[60, "/srv/other"]]);
    expect(sessions.a.cores).toBeCloseTo(8.15, 0);
    expect(unattributed.find((g) => g.name === "npm")).toMatchObject({
      count: 1,
      cores: 3,
    });
    expect(unattributed.map((g) => g.name)).toContain("clang");
    // Quiet leftovers (init, tmux) aren't listed.
    expect(unattributed.map((g) => g.name)).not.toContain("tmux");
  });
});

describe("looking up cwds", () => {
  it("only asks about heavy unowned processes and their unowned parents", () => {
    expect(cwdCandidates(procs, owner).sort((x, y) => x - y)).toEqual([
      50, 51, 52, 60, 61, 62,
    ]);
    expect(
      cwdCandidates(parsePsTable("1 0 0.0 10 init\n7 1 1.0 10 x"), new Map())
    ).toEqual([]);
  });

  it("parses lsof's field output", () => {
    expect(parseLsofCwd("p12\nfcwd\nn/w/a\np13\nfcwd\nn/tmp\n")).toEqual(
      new Map([
        [12, "/w/a"],
        [13, "/tmp"],
      ])
    );
  });

  it("matches the longest worktree on a path boundary, and skips shared dirs", () => {
    const paths = sessionPaths(
      [
        row("a", { worktree_path: "/w/a" }),
        row("ab", { worktree_path: "/w/ab" }),
        row("home", { worktree_path: null, working_directory: "~" }),
        row("s1", { worktree_path: null, working_directory: "/p/shared" }),
        row("s2", { worktree_path: null, working_directory: "/p/shared" }),
        row("own", { worktree_path: null, working_directory: "~/proj" }),
      ],
      HOME
    );
    expect(matchSession("/w/ab/x", paths)).toBe("ab");
    expect(matchSession("/w/a/x", paths)).toBe("a");
    expect(matchSession("/w/abc", paths)).toBeNull();
    expect(matchSession("/p/shared", paths)).toBeNull();
    expect(matchSession(HOME, paths)).toBeNull();
    expect(matchSession("/home/u/proj/src", paths)).toBe("own");
  });
});

describe("a chat's worker", () => {
  it("lands on the chat session beside a terminal's pane", () => {
    const chatRows = [row("c"), row("t")];
    const ps = parsePsTable(
      "1 0 0 1 init\n40 1 0 1 sh\n41 40 150 1024 node\n42 1 200 1024 zsh"
    );
    const own = claimSessions(
      ps,
      [
        { tmux: "aos-chat-c", pid: 40 },
        { tmux: "claude-t", pid: 42 },
      ],
      chatRows
    );
    const { sessions } = attributeLoad({
      procs: ps,
      owner: own,
      rows: chatRows,
      cwds: new Map(),
      home: HOME,
    });
    expect(sessions.c.cores).toBe(1.5);
    expect(sessions.t.cores).toBe(2);
  });
});
