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
