import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { saveItem } from "./chat/store";
import { chatNeed, isUnread, needsYou, terminalStatus } from "./needs-you";

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
    expect(chatNeed(orch, "waiting", 0)).toBe("answer");
  });

  it("finds the pending approval under a newer answered question", () => {
    const id = randomUUID();
    saveItem(id, {
      id: "a2",
      kind: "approval",
      createdAt: Date.now(),
      toolName: "Bash",
      title: "Run",
      input: {},
      canAlways: false,
      status: "pending",
    });
    saveItem(id, {
      id: "q1",
      kind: "approval",
      createdAt: Date.now(),
      toolName: "AskUserQuestion",
      title: "Which?",
      input: {},
      canAlways: false,
      status: "answered",
      questions: [
        { question: "Which?", header: "Pick", multiSelect: false, options: [] },
      ],
    });
    expect(chatNeed({ id }, "waiting")).toBe("approve");
  });
});

describe("isUnread", () => {
  it("is set by a finished turn you haven't opened, cleared once seen", () => {
    const chat = finishedUnseen(null);
    expect(isUnread(chat, "idle")).toBe(true);
    expect(isUnread(chat, "running")).toBe(false);
    expect(isUnread(chat, "waiting")).toBe(false);
    expect(
      isUnread({ ...chat, last_seen_at: "2999-01-01 00:00:00" }, "idle")
    ).toBe(false);
  });

  it("counts an orchestrator's reply to the reader, never one to an event", () => {
    const id = randomUUID();
    const orchestrator = {
      id,
      view: "chat" as const,
      updated_at: "2026-10-06 12:00:00",
      last_seen_at: null,
      role: "orchestrator" as const,
    };
    const now = Date.now();
    const event = (n: number) =>
      saveItem(id, {
        id: `e${n}`,
        kind: "user",
        text: "PR #12 merged",
        tagged: true,
        origin: { kind: "event", label: "AgentOS" },
        createdAt: now + n,
      });
    const end = (n: number) =>
      saveItem(id, { id: `t${n}`, kind: "turn_end", createdAt: now + n });

    // An event and the turn it started: routine, not news.
    event(1);
    end(2);
    expect(isUnread(orchestrator, "idle")).toBe(false);

    // The reader asks, it replies: unread until seen.
    saveItem(id, {
      id: "u3",
      kind: "user",
      text: "status?",
      tagged: true,
      createdAt: now + 3,
    });
    end(4);
    expect(isUnread(orchestrator, "idle")).toBe(true);
    expect(isUnread(orchestrator, "running")).toBe(false);

    // An event after it doesn't hide the reply, and doesn't count once seen.
    event(5);
    end(6);
    expect(isUnread(orchestrator, "idle")).toBe(true);
    expect(
      isUnread({ ...orchestrator, last_seen_at: "2999-01-01 00:00:00" }, "idle")
    ).toBe(false);
  });

  it("ignores an orchestrator's old untagged event messages by their text", () => {
    const id = randomUUID();
    saveItem(id, {
      id: "p1",
      kind: "user",
      text: '[AgentOS message from "poise-task" (abc-123)] done',
      createdAt: Date.now(),
    });
    saveItem(id, { id: "t1", kind: "turn_end", createdAt: Date.now() });
    expect(
      isUnread(
        {
          id,
          view: "chat",
          updated_at: "2026-10-06 12:00:00",
          last_seen_at: null,
          role: "orchestrator",
        },
        "idle"
      )
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

describe("terminalStatus", () => {
  const row = (seen: string | null) => ({
    id: randomUUID(),
    view: "terminal" as const,
    updated_at: "2026-10-06 12:00:00",
    last_seen_at: seen,
  });

  it("asks for input on a prompt you haven't seen", () => {
    expect(terminalStatus(row("2026-10-06 11:00:00"), "waiting")).toEqual({
      status: "waiting",
      need: "input",
      unread: false,
    });
  });

  it("drops a prompt you've seen to idle, read", () => {
    expect(terminalStatus(row("2026-10-06 13:00:00"), "waiting")).toEqual({
      status: "idle",
      need: null,
      unread: false,
    });
  });

  it("never marks a running terminal unread", () => {
    expect(terminalStatus(row("2026-10-06 11:00:00"), "running").unread).toBe(
      false
    );
    expect(terminalStatus(row("2026-10-06 11:00:00"), "idle").unread).toBe(
      true
    );
  });

  it("has nothing unread without a row", () => {
    expect(terminalStatus(undefined, "idle")).toEqual({
      status: "idle",
      need: null,
      unread: false,
    });
  });
});
