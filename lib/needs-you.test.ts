import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { saveItem } from "./chat/store";
import { needsYou } from "./needs-you";

// A chat that finished a turn you haven't looked at.
function finishedUnseen(role: "orchestrator" | null) {
  const id = randomUUID();
  saveItem(id, { id: "t1", kind: "turn_end", createdAt: Date.now() });
  return {
    id,
    view: "chat" as const,
    updated_at: "2026-10-06 12:00:00",
    last_seen_at: null,
    role,
  };
}

describe("needsYou", () => {
  it("counts a finished, unseen turn for an ordinary chat", () => {
    expect(needsYou(finishedUnseen(null), "idle")).toBe(true);
  });

  it("counts only a waiting card for an orchestrator", () => {
    const orchestrator = finishedUnseen("orchestrator");
    expect(needsYou(orchestrator, "idle")).toBe(false);
    expect(needsYou(orchestrator, null)).toBe(false);
    expect(needsYou(orchestrator, "waiting")).toBe(true);
  });
});
