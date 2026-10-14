import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type { ChatItem } from "./chat/events";
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

  it("never counts a finished task's chat, unread turn or not", () => {
    for (const task_status of ["merged", "done", "dropped"] as const)
      expect(needsYou({ ...finishedUnseen(null), task_status }, "idle")).toBe(
        false
      );
    expect(
      needsYou({ ...finishedUnseen(null), task_status: "running" }, "idle")
    ).toBe(true);
  });

  it("drops a turn that ended before the session was put on Done", () => {
    const chat = finishedUnseen(null);
    const settled = (ms: number) =>
      new Date(ms).toISOString().slice(0, 19).replace("T", " ");
    const now = Date.now();
    expect(needsYou({ ...chat, settled_at: settled(now + 5000) }, "idle")).toBe(
      false
    );
    // A turn that ends after it was settled is news again.
    expect(
      needsYou({ ...chat, settled_at: settled(now - 60_000) }, "idle")
    ).toBe(true);
    // A pending approval always counts.
    expect(
      needsYou({ ...chat, settled_at: settled(now + 5000) }, "waiting")
    ).toBe(true);
    expect(needsYou({ ...chat, archived_at: settled(now) }, "idle")).toBe(
      false
    );
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

  // An orchestrator's chat, its items a second apart (last_seen_at is
  // to the second).
  function orchestratorChat() {
    const id = randomUUID();
    const base = Date.parse("2026-10-06T12:00:00Z");
    let n = 0;
    const at = () => base + ++n * 1000;
    return {
      session: {
        id,
        view: "chat" as const,
        updated_at: "2026-10-06 12:00:00",
        last_seen_at: null as string | null,
        role: "orchestrator" as const,
      },
      user: (over: Partial<Extract<ChatItem, { kind: "user" }>> = {}) =>
        saveItem(id, {
          id: randomUUID(),
          kind: "user",
          text: "status?",
          tagged: true,
          createdAt: at(),
          ...over,
        }),
      end: () => {
        const createdAt = at();
        saveItem(id, { id: randomUUID(), kind: "turn_end", createdAt });
        return new Date(createdAt).toISOString().slice(0, 19).replace("T", " ");
      },
    };
  }
  const event = { origin: { kind: "event" as const, label: "AgentOS" } };

  it("counts an orchestrator's reply to the reader, never one to an event", () => {
    const chat = orchestratorChat();
    // An event and the turn it started: routine, not news.
    chat.user(event);
    chat.end();
    expect(isUnread(chat.session, "idle")).toBe(false);

    // The reader asks, it replies: unread until seen.
    chat.user();
    const replied = chat.end();
    expect(isUnread(chat.session, "idle")).toBe(true);
    expect(isUnread(chat.session, "running")).toBe(false);

    // Events after it don't hide the reply, nor bring it back once seen.
    chat.user(event);
    chat.end();
    chat.user({ from: "agentos" });
    chat.user({
      text: '[AgentOS message from "poise-task" (abc-123)] done',
      tagged: undefined,
    });
    chat.end();
    expect(isUnread(chat.session, "idle")).toBe(true);
    expect(isUnread({ ...chat.session, last_seen_at: replied }, "idle")).toBe(
      false
    );
  });

  it("counts a decision as the reader's; peers, schedules and AgentOS don't", () => {
    const cases: [Partial<Extract<ChatItem, { kind: "user" }>>, boolean][] = [
      [{ origin: { kind: "decision", label: "Plan" } }, true],
      [{ peer: { sessionId: "s1", body: "done" }, from: "poise" }, false],
      [{ from: "agentos" }, false],
      [{ origin: { kind: "schedule", label: "Nightly" } }, false],
      [
        {
          text: '[AgentOS message from "poise-task" (abc-123)] done',
          tagged: undefined,
        },
        false,
      ],
    ];
    for (const [over, unread] of cases) {
      const chat = orchestratorChat();
      chat.user(over);
      chat.end();
      expect(isUnread(chat.session, "idle"), JSON.stringify(over)).toBe(unread);
    }
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
