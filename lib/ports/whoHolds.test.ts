import { describe, expect, it } from "vitest";
import { describeHolder, judgePort, whoHolds } from "./whoHolds";
import type { DevServerPortRow, Listener, SessionPortRow } from "./types";

const sessions: SessionPortRow[] = [
  {
    id: "a",
    name: "fix-login",
    project: "app",
    worktree: "/w/app-fix-login",
    ports: { PORT: 3101 },
    devServerPort: 3101,
  },
  {
    id: "b",
    name: "add-search",
    project: "app",
    worktree: "/w/app-add",
    ports: { PORT: 3102 },
    devServerPort: 3102,
  },
];
const panel: DevServerPortRow[] = [
  { id: "d", name: "web", pid: 77, ports: [4000] },
];
const at = (port: number, more: Partial<Listener> = {}): Listener => ({
  port,
  pid: 10,
  command: "node",
  cwd: null,
  ...more,
});

describe("whoHolds", () => {
  it("names the session whose worktree the listener runs in, whatever port it took", () => {
    const h = whoHolds(
      3000,
      [at(3000, { cwd: "/w/app-fix-login/web" })],
      sessions,
      panel
    );
    expect(h).toMatchObject({
      kind: "session",
      sessionId: "a",
      pid: 10,
      listening: true,
    });
  });

  it("doesn't take a sibling folder for the worktree", () => {
    const h = whoHolds(
      3000,
      [at(3000, { cwd: "/w/app-fix-login-2" })],
      sessions,
      panel
    );
    expect(h).toMatchObject({ kind: "outside", cwd: "/w/app-fix-login-2" });
  });

  it("calls a known cwd outside every worktree outside AgentOS, even on a session's port", () => {
    const h = whoHolds(
      3102,
      [at(3102, { cwd: "/home/u/old" })],
      sessions,
      panel
    );
    expect(h).toMatchObject({ kind: "outside", pid: 10 });
  });

  it("gives a listener with no readable cwd to the session that holds the port", () => {
    expect(whoHolds(3102, [at(3102)], sessions, panel)).toMatchObject({
      kind: "session",
      sessionId: "b",
    });
  });

  it("names the Dev Servers panel's server by pid or port, and a Windows process", () => {
    expect(
      whoHolds(5000, [at(5000, { pid: 77 })], sessions, panel)
    ).toMatchObject({
      kind: "dev-server",
      name: "web",
    });
    expect(whoHolds(4000, [], sessions, panel)).toMatchObject({
      kind: "dev-server",
    });
    expect(
      whoHolds(3000, [at(3000, { pid: 4242, windows: true })], sessions, panel)
    ).toEqual({ kind: "windows", pid: 4242 });
  });

  it("is a session that holds the port but isn't listening, or nothing", () => {
    expect(whoHolds(3101, [], sessions, panel)).toMatchObject({
      kind: "session",
      sessionId: "a",
      listening: false,
    });
    expect(whoHolds(3999, [], sessions, panel)).toBeNull();
  });
});

describe("judgePort", () => {
  it("is free for the session's own port before its server starts", () => {
    expect(judgePort("a", "PORT", 3101, [], sessions, panel)).toMatchObject({
      free: true,
      mine: true,
    });
  });

  it("is not free, but mine, once its own server runs", () => {
    const c = judgePort(
      "a",
      "PORT",
      3101,
      [at(3101, { cwd: "/w/app-fix-login" })],
      sessions,
      panel
    );
    expect(c).toMatchObject({ free: false, mine: true });
  });

  it("is taken when someone else holds it, and unknown when nothing can be asked", () => {
    expect(
      judgePort("a", null, 3000, [at(3000)], sessions, panel)
    ).toMatchObject({
      free: false,
      mine: false,
    });
    expect(judgePort("a", null, 3000, null, sessions, panel).free).toBeNull();
  });
});

describe("describeHolder", () => {
  it("says who, in words an agent can act on", () => {
    expect(
      describeHolder({
        kind: "session",
        sessionId: "a",
        name: "fix-login",
        project: "app",
        pid: 9,
        listening: true,
      })
    ).toBe('session "fix-login" (project app), pid 9');
    expect(
      describeHolder({ kind: "outside", pid: 9, command: "node", cwd: "/x" })
    ).toBe("pid 9 (node) in /x, outside AgentOS");
  });
});
