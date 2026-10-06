import { describe, it, expect } from "vitest";
import { matchesRef, overRateLimit, wakeLine } from "./format";

describe("wakeLine", () => {
  it("labels agent messages and says how to reply", () => {
    const line = wakeLine({
      fromName: "fast-shadow",
      fromId: "a",
      body: "is the API\nready?",
    });
    expect(line).toBe(
      '[AgentOS message from agent session "fast-shadow"]: is the API ready?. Reply with: aos send fast-shadow "<message>"'
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
