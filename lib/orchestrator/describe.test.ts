import { describe, expect, it } from "vitest";
import { describeSessions } from "./describe";
import type { SessionFacts } from "./facts";

const facts = (plan: SessionFacts["plan"]): SessionFacts => ({
  id: "12345678-aaaa",
  name: "fix flag",
  project: "app",
  view: "chat",
  status: "running",
  activity: null,
  needsInput: false,
  lastActive: 0,
  branch: "feature/x",
  plan,
  task: { state: "working", pr: null, blocked: null },
  stack: null,
});

describe("describeSessions", () => {
  it("shows the plan decision and its reason on a task", () => {
    expect(
      describeSessions("ws", [
        facts({ planned: true, reason: "touches 6 files" }),
      ])
    ).toContain("planned: ");
    expect(
      describeSessions("ws", [
        facts({ planned: false, reason: "one-line default change" }),
      ])
    ).toContain("no plan: ");
    expect(describeSessions("ws", [facts(null)])).not.toMatch(/plan/);
  });
});

describe("sessions that wait on each other", () => {
  it("shows who a session waits on and who waits on it", () => {
    const text = describeSessions("ws", [
      {
        ...facts(null),
        waits: {
          on: [{ name: "builder", kind: "reply", leftMs: 12 * 60_000 }],
          by: ["tester"],
        },
      },
    ]);
    expect(text).toContain("waiting on");
    expect(text).toContain("builder");
    expect(text).toContain("12m left");
    expect(text).toContain("tester");
    expect(text).toContain("waiting on it");
  });
});

describe("done and idle sessions", () => {
  const idle = (name: string, over: Partial<SessionFacts> = {}) => ({
    ...facts(null),
    id: `${name}-0000-aaaa`,
    name,
    status: "idle" as const,
    task: null,
    ...over,
  });

  it("lists done sessions as done, and plain idle ones compactly, after the rest", () => {
    const text = describeSessions("ws", [
      idle("finished", { done: true }),
      idle("resting"),
      facts(null),
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toContain("3 sessions");
    expect(lines[1]).toContain("fix flag");
    expect(lines[2]).toMatch(/^Idle: resting \(app, id resting-\)/);
    expect(lines[3]).toMatch(/^Done \(on the owner's Done shelf\): finished/);
    expect(text).not.toMatch(/- finished/);
  });
});
