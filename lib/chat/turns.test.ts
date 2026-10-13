import { describe, expect, it } from "vitest";
import type { ChatItem, ChatOrigin } from "./events";
import { groupTimeline, sameBlock } from "./group";
import { locate } from "./find";
import { activityOrigin, eventTurnAt, plainSummary } from "./turns";

type UserItem = Extract<ChatItem, { kind: "user" }>;

const user = (id: string, over: Partial<UserItem> = {}): UserItem => ({
  id,
  kind: "user",
  text: "hello",
  tagged: true,
  createdAt: 1000,
  ...over,
});
const event = (id: string, over: Partial<ChatOrigin> = {}): UserItem =>
  user(id, {
    text: "PR #1: CI green",
    from: "agentos",
    origin: { kind: "event", label: "AgentOS", ...over },
  });
const reply = (id: string, text = "Merged it.\n\nNext."): ChatItem => ({
  id,
  kind: "assistant",
  text,
  createdAt: 1001,
});
const end = (id: string): ChatItem => ({
  id,
  kind: "turn_end",
  createdAt: 1002,
});

describe("activityOrigin", () => {
  it("is set for events, task messages, schedules and system lines", () => {
    for (const kind of ["event", "peer", "schedule", "system"] as const)
      expect(
        activityOrigin(user("u", { origin: { kind, label: "x" } }))?.kind
      ).toBe(kind);
  });

  it("is null for what the reader typed or decided", () => {
    expect(activityOrigin(user("u"))).toBeNull();
    expect(activityOrigin(user("u", { from: "you" }))).toBeNull();
    expect(
      activityOrigin(user("u", { origin: { kind: "decision", label: "Saad" } }))
    ).toBeNull();
  });

  it("is null for a batch carrying the reader's answers", () => {
    expect(activityOrigin(event("u", { decided: ["Approved #3"] }))).toBeNull();
  });

  it("reads untagged history by its text, and only that", () => {
    const old = { tagged: undefined, origin: undefined };
    expect(
      activityOrigin(
        user("u", { ...old, text: '[Scheduled message "Triage", saved]\nx' })
      )?.kind
    ).toBe("schedule");
    expect(activityOrigin(user("u", { ...old, from: "agentos" }))?.kind).toBe(
      "event"
    );
    expect(
      activityOrigin(user("u", { ...old, text: "just typing" }))
    ).toBeNull();
    // Typed since tagging: the same words are the reader's.
    expect(
      activityOrigin(user("u", { text: '[Scheduled message "Triage", x]' }))
    ).toBeNull();
  });
});

describe("eventTurnAt", () => {
  it("runs from the event to the end of the turn", () => {
    const items = [event("e1"), reply("a1"), end("t1"), user("u2")];
    const found = eventTurnAt(items, 0)!;
    expect(found.end).toBe(3);
    expect(found.turn.replies.map((i) => i.id)).toEqual(["a1", "t1"]);
    expect(found.turn.live).toBe(false);
  });

  it("stops before a message sent while it was working", () => {
    const items = [event("e1"), reply("a1"), user("u2")];
    expect(eventTurnAt(items, 0)!.end).toBe(2);
  });

  it("is live while the last turn has no end", () => {
    expect(eventTurnAt([event("e1"), reply("a1")], 0)!.turn.live).toBe(true);
  });

  it("summarises the start of the reply, else the event", () => {
    expect(
      eventTurnAt([event("e1"), reply("a1", "## **Merged** #88\nmore")], 0)!
        .turn.summary
    ).toBe("Merged #88");
    expect(eventTurnAt([event("e1")], 0)!.turn.summary).toBe("PR #1: CI green");
  });

  it("names the task from the origin, with a count for several", () => {
    const one = event("e1", { subjects: [{ id: "s1", name: "billing" }] });
    expect(eventTurnAt([one], 0)!.turn.task).toBe("billing");
    const two = event("e2", {
      subjects: [
        { id: "s1", name: "billing" },
        { id: "s2", name: "api" },
      ],
    });
    expect(eventTurnAt([two], 0)!.turn.task).toBe("billing +1");
    expect(eventTurnAt([event("e3")], 0)!.turn.task).toBe("AgentOS");
  });

  it("never folds a turn that needs the reader", () => {
    const approval: ChatItem = {
      id: "ap",
      kind: "approval",
      status: "pending",
    } as ChatItem;
    expect(eventTurnAt([event("e1"), approval], 0)).toBeNull();
    const error: ChatItem = {
      id: "er",
      kind: "error",
      message: "x",
      createdAt: 0,
    };
    expect(eventTurnAt([event("e1"), error], 0)).toBeNull();
  });

  it("flags a turn that asked a question", () => {
    const q: ChatItem = {
      id: "q",
      kind: "tool",
      name: "mcp__orchestrator__question",
      title: "question",
      input: {},
      status: "done",
      createdAt: 0,
    };
    expect(eventTurnAt([event("e1"), q, end("t")], 0)!.turn.hasQuestion).toBe(
      true
    );
  });
});

describe("plainSummary", () => {
  it("strips markdown and caps the length", () => {
    expect(plainSummary("- [PR #4](http://x) is `green`")).toBe(
      "PR #4 is green"
    );
    expect(plainSummary("x".repeat(300)).length).toBe(140);
  });
});

describe("groupTimeline with foldEvents", () => {
  const items: ChatItem[] = [
    event("e1"),
    reply("a1"),
    end("t1"),
    event("e2"),
    reply("a2"),
    end("t2"),
    user("typed"),
    reply("a3"),
    end("t3"),
    event("e3"),
    reply("a4"),
  ];

  it("groups consecutive event turns, split by what the reader typed", () => {
    const blocks = groupTimeline(items, { foldEvents: true });
    expect(blocks.map((b) => b.type)).toEqual([
      "events",
      "item",
      "item",
      "item",
      "events",
    ]);
    const first = blocks[0];
    expect(first.type === "events" && first.turns.map((t) => t.id)).toEqual([
      "e1",
      "e2",
    ]);
    // The reader's own message and the reply to it stay whole.
    expect(blocks[1]).toMatchObject({ item: { id: "typed" } });
  });

  it("leaves the timeline alone otherwise", () => {
    expect(groupTimeline(items).some((b) => b.type === "events")).toBe(false);
  });

  it("compares events blocks by their items", () => {
    const a = groupTimeline(items, { foldEvents: true });
    const b = groupTimeline(items, { foldEvents: true });
    expect(sameBlock(a[0], b[0])).toBe(true);
    const grown = groupTimeline([...items, reply("a5")], { foldEvents: true });
    expect(sameBlock(a[4], grown[4])).toBe(false);
  });

  it("finds a folded reply by opening its group and turn", () => {
    const where = locate(items, "a2", { foldEvents: true })!;
    expect(where.block).toBe("ev-e1");
    expect(where.open).toEqual(["events:ev-e1", "eventturn:e2"]);
  });
});
