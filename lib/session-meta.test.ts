import { describe, it, expect } from "vitest";
import {
  busiest,
  sessionRowInfo,
  stateFromTitle,
  taskFromTitle,
  tmuxRowInfo,
  compactTimeAgo,
  fromSqliteTime,
  rowMeta,
  tmuxDisplayName,
} from "./session-meta";

const now = new Date("2026-10-05T12:00:00Z");
const ago = (mins: number) => new Date(now.getTime() - mins * 60000);

describe("compactTimeAgo", () => {
  it("shortens to the largest unit", () => {
    expect(compactTimeAgo(ago(0), now)).toBe("now");
    expect(compactTimeAgo(ago(5), now)).toBe("5m");
    expect(compactTimeAgo(ago(180), now)).toBe("3h");
    expect(compactTimeAgo(ago(60 * 48), now)).toBe("2d");
  });
});

describe("fromSqliteTime", () => {
  it("reads SQLite's zone-less UTC timestamps as UTC", () => {
    expect(fromSqliteTime("2026-10-05 12:00:00").toISOString()).toBe(
      "2026-10-05T12:00:00.000Z"
    );
  });
});

describe("rowMeta", () => {
  it("names states that need a human, otherwise shows last activity", () => {
    expect(rowMeta("waiting", ago(5), now).text).toBe("Needs input");
    expect(rowMeta("running", ago(5), now).text).toBe("Working");
    expect(rowMeta("idle", ago(5), now).text).toBe("5m");
  });
});

describe("tmuxDisplayName", () => {
  it("drops mTerm's prefix only", () => {
    expect(tmuxDisplayName("mterm-dashboards")).toBe("dashboards");
    expect(tmuxDisplayName("dev-server")).toBe("dev-server");
  });
});

describe("agent state from Claude's title", () => {
  it("reads working, your turn and the task", () => {
    expect(stateFromTitle("⠂ Fix login")).toBe("working");
    expect(stateFromTitle("✳ Fix login")).toBe("waiting");
    expect(stateFromTitle("✳ Claude Code")).toBe("idle");
    expect(stateFromTitle("zsh")).toBeNull();
    expect(taskFromTitle("✳ Fix login")).toBe("Fix login");
    expect(taskFromTitle("✳ Claude Code")).toBeNull();
  });

  it("describes a managed session like mTerm's subtitle", () => {
    expect(sessionRowInfo("dead")).toEqual({
      running: false,
      state: "idle",
      subtitle: null,
    });
    expect(sessionRowInfo("running", "⠂ Ship it").subtitle).toBe("Ship it");
    expect(sessionRowInfo("waiting", "").subtitle).toBe("your turn");
    expect(sessionRowInfo("error", "✳ Deploy").subtitle).toBe(
      "needs you · Deploy"
    );
  });

  it("calls a non-Claude tmux session a shell", () => {
    expect(tmuxRowInfo("bash")).toEqual({
      running: true,
      state: "idle",
      subtitle: "shell",
    });
    expect(tmuxRowInfo("⠂ Review PR").state).toBe("working");
  });

  it("ranks the state that needs you highest", () => {
    expect(busiest("working", "waiting")).toBe("waiting");
    expect(busiest("blocked", "working")).toBe("blocked");
  });
});
