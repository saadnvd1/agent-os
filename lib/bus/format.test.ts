import { describe, it, expect } from "vitest";
import { RELAY_LIMIT, matchesRef, overRateLimit, wakeLine } from "./format";

describe("wakeLine", () => {
  it("names the sender and has the reply go to its id", () => {
    const line = wakeLine({
      fromName: "orchestrator",
      fromId: "3f2a9c1e-7b6d-4c1a-9e2f-000000000000",
      body: "is the API\nready?",
    });
    expect(line).toBe(
      '[AgentOS message from "orchestrator" (3f2a9c1e)]: is the API ready?. Reply with: aos send 3f2a9c1e "<message>"'
    );
  });

  it("labels the human and leaves long bodies in the inbox", () => {
    expect(wakeLine({ fromName: "you", fromId: null, body: "hi" })).toContain(
      "the user"
    );
    expect(
      wakeLine({ fromName: "x", fromId: "a", body: "y".repeat(700) })
    ).toContain("aos inbox");
  });
});

describe("wakeLine for a reply", () => {
  it("says which request it answers and keeps the message prefix", () => {
    const line = wakeLine(
      { fromName: "b", fromId: "3f2a9c1e-0000", body: "done" },
      { replyTo: { id: 12, excerpt: "ship it?" } }
    );
    expect(line).toBe(
      '[AgentOS message from "b" (3f2a9c1e), replying to your #12 ("ship it?")]: done. Reply with: aos send 3f2a9c1e "<message>"'
    );
    expect(line.startsWith("[AgentOS message from")).toBe(true);
  });
});

describe("matchesRef across workspaces", () => {
  const s = {
    id: "id-1",
    name: "planner",
    projectName: "app",
    tmuxName: "claude-1",
    workspaceName: "Alpha",
    orchestrator: true,
  };
  it("matches workspace/name and, for an orchestrator, workspace/orchestrator", () => {
    expect(matchesRef("alpha/planner", s)).toBe(true);
    expect(matchesRef("ALPHA/orchestrator", s)).toBe(true);
    expect(
      matchesRef("alpha/orchestrator", { ...s, orchestrator: false })
    ).toBe(false);
    expect(matchesRef("beta/orchestrator", s)).toBe(false);
  });
});

describe("wakeLine for a linked machine", () => {
  const long = "word ".repeat(400).trim();
  it("carries a long body whole instead of a stub", () => {
    const line = wakeLine(
      { fromName: "x", fromId: "abcdef123", body: long },
      { inline: true }
    );
    expect(line).toContain(long);
    expect(line).not.toContain("aos inbox");
  });

  it("says so when a huge body is cut", () => {
    const line = wakeLine(
      { fromName: "x", fromId: null, body: "y".repeat(RELAY_LIMIT + 50) },
      { inline: true }
    );
    expect(line).toContain("[cut: 50 more chars");
  });

  it("keeps the stub for a local session", () => {
    expect(wakeLine({ fromName: "x", fromId: "a", body: long })).toContain(
      "Read it with: aos inbox"
    );
  });
});

describe("overRateLimit", () => {
  it("trips at the limit inside the window only", () => {
    const now = 1_000_000;
    const recent = Array.from({ length: 3 }, (_, i) => now - i * 1000);
    expect(overRateLimit(recent, now, { max: 3, windowMs: 60_000 })).toBe(true);
    expect(
      overRateLimit(recent, now + 120_000, { max: 3, windowMs: 60_000 })
    ).toBe(false);
  });
});

describe("matchesRef", () => {
  const s = {
    id: "id-1",
    name: "Fast-Shadow",
    projectName: "dashboards",
    tmuxName: "claude-id-1",
  };
  it("matches by name, project/name, id or tmux name", () => {
    for (const ref of [
      "fast-shadow",
      "dashboards/fast-shadow",
      "id-1",
      "claude-id-1",
    ]) {
      expect(matchesRef(ref, s)).toBe(true);
    }
    expect(matchesRef("other", s)).toBe(false);
  });
});
