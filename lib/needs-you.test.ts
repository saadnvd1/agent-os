import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { saveItem } from "./chat/store";
import { chatNeed, isUnread, needsYou } from "./needs-you";

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

function approval(questions: boolean) {
  const id = randomUUID();
  saveItem(id, {
    id: "a1",
    kind: "approval",
    createdAt: Date.now(),
    toolName: "Bash",
    title: "Run tests",
    input: {},
    canAlways: false,
    status: "pending",
    ...(questions && {
      questions: [
        { question: "Which?", header: "Pick", multiSelect: false, options: [] },
      ],
    }),
  } as Parameters<typeof saveItem>[1]);
  return id;
}

describe("chatNeed", () => {
  it("tells an approval from a question", () => {
    expect(chatNeed({ id: approval(false) }, "waiting")).toBe("approve");
    expect(chatNeed({ id: approval(true) }, "waiting")).toBe("answer");
  });

  it("marks an errored chat failed and a quiet one as nothing", () => {
    expect(chatNeed({ id: randomUUID() }, "error")).toBe("failed");
    expect(chatNeed({ id: randomUUID() }, "idle")).toBeNull();
  });

  it("asks an orchestrator to answer only with open asks", () => {
    const orch = { id: randomUUID(), role: "orchestrator" as const };
    expect(chatNeed(orch, "idle", 2)).toBe("answer");
    expect(chatNeed(orch, "idle", 0)).toBeNull();
  });
});

describe("isUnread", () => {
  it("is set by a finished turn you haven't opened, cleared once seen", () => {
    const chat = finishedUnseen(null);
    expect(isUnread(chat, "idle")).toBe(true);
    expect(isUnread(chat, "running")).toBe(false);
    expect(
      isUnread({ ...chat, last_seen_at: "2999-01-01 00:00:00" }, "idle")
    ).toBe(false);
  });

  it("follows updated_at for a terminal", () => {
    const terminal = {
      id: randomUUID(),
      view: "terminal" as const,
      updated_at: "2026-10-06 12:00:00",
      last_seen_at: "2026-10-06 11:00:00",
    };
    expect(isUnread(terminal, null)).toBe(true);
    expect(
      isUnread({ ...terminal, last_seen_at: "2026-10-06 13:00:00" }, null)
    ).toBe(false);
  });
});
