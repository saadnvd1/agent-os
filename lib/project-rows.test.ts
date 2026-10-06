import { describe, it, expect } from "vitest";
import { projectRow, type ProjectRowInput } from "./project-rows";
import type { Session } from "./db";
import type { TmuxSessionInfo } from "./status-detector";

const session = (id: string) => ({ id }) as Session;
const tmux = (name: string, title = "bash") =>
  ({ name, hostId: "local", title }) as TmuxSessionInfo;
const input = (over: Partial<ProjectRowInput>): ProjectRowInput => ({
  sessions: [],
  hasWorkers: () => false,
  tmux: [],
  statuses: {},
  ...over,
});

describe("projectRow", () => {
  it("is not running with nothing alive", () => {
    const row = projectRow(input({ sessions: [session("a")] }));
    expect(row).toMatchObject({
      running: false,
      subtitle: null,
      state: "idle",
    });
  });

  it("a single session becomes the row", () => {
    const row = projectRow(input({ tmux: [tmux("tool-app", "⠂ Fix login")] }));
    expect(row.single).toEqual({
      kind: "tmux",
      name: "tool-app",
      hostId: "local",
    });
    expect(row).toMatchObject({
      running: true,
      state: "working",
      subtitle: "Fix login",
    });
  });

  it("several sessions expand instead, showing the busiest state", () => {
    const row = projectRow(
      input({
        sessions: [session("a")],
        statuses: { a: { status: "waiting" } },
        tmux: [tmux("dev", "⠂ build")],
      })
    );
    expect(row.single).toBeNull();
    expect(row).toMatchObject({
      state: "waiting",
      subtitle: "2 sessions",
      sessionCount: 2,
    });
  });

  it("a session with workers is never folded into the row", () => {
    const row = projectRow(
      input({ sessions: [session("a")], hasWorkers: () => true })
    );
    expect(row.single).toBeNull();
  });

  it("a session created in the last day keeps its project visible", () => {
    const now = Date.parse("2026-10-06T04:00:00Z");
    const at = (created_at: string) => ({ id: "s", created_at }) as Session;
    expect(
      projectRow(input({ sessions: [at("2026-10-06 03:31:59")], now })).fresh
    ).toBe(true);
    expect(
      projectRow(input({ sessions: [at("2026-10-04 03:31:59")], now })).fresh
    ).toBe(false);
  });

  it("opens the most recently used session, else starts one", () => {
    const at = (id: string, updated_at: string) =>
      ({ id, updated_at, created_at: updated_at }) as Session;
    const row = projectRow(
      input({
        sessions: [
          at("old", "2026-10-01 10:00:00"),
          at("new", "2026-10-05 10:00:00"),
        ],
      })
    );
    expect(row.latest).toEqual({ kind: "session", id: "new" });
    expect(
      projectRow(input({ tmux: [tmux("t1"), tmux("t2")] })).latest
    ).toEqual({ kind: "tmux", name: "t1", hostId: "local" });
    expect(projectRow(input({})).latest).toBeNull();
  });
});
