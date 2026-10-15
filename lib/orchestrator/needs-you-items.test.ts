import { describe, expect, it } from "vitest";
import type { AskView, QuestionView } from "./ask-view";
import { needsYouItems } from "./needs-you-items";

const ask = (id: number, over: Partial<AskView> = {}): AskView => ({
  id,
  subject: `s${id}`,
  kind: "decision",
  title: `ask ${id}`,
  why: "",
  detail: "",
  link: null,
  sha: null,
  binding: "",
  presence: false,
  createdAt: `2026-10-13 0${id}:00:00`,
  ...over,
});
const question = (
  id: number,
  over: Partial<QuestionView> = {}
): QuestionView => ({
  id,
  text: `q ${id}`,
  task: null,
  taskName: null,
  createdAt: `2026-10-13 0${id}:30:00`,
  ...over,
});

describe("needsYouItems", () => {
  it("lists asks (gates included) and questions, newest first", () => {
    const items = needsYouItems({
      asks: [ask(1), ask(3, { kind: "gate" })],
      questions: [question(2)],
      dismissed: [],
    });
    expect(items.map((i) => i.key)).toEqual(["ask:3", "question:2", "ask:1"]);
  });

  it("hides what was dismissed, and only that", () => {
    const items = needsYouItems({
      asks: [ask(1), ask(2)],
      questions: [question(1)],
      dismissed: ["ask:1"],
    });
    expect(items.map((i) => i.key)).toEqual(["ask:2", "question:1"]);
  });

  it("lists tasks that wait on him, not ones that merely failed", () => {
    const items = needsYouItems({
      asks: [],
      questions: [],
      dismissed: [],
      tasks: [
        { sessionId: "a", name: "api", need: "approve" },
        { sessionId: "b", name: "web", need: "failed" },
        { sessionId: "c", name: "db", need: "unsent" },
      ],
    });
    expect(items).toMatchObject([
      { key: "task:a", sub: "Approve", title: "api" },
    ]);
  });

  it("puts the chat waiting on him first", () => {
    const items = needsYouItems({
      asks: [ask(1)],
      questions: [],
      dismissed: [],
      chatWaiting: true,
    });
    expect(items[0].kind).toBe("chat");
  });

  it("lists learning cards with the session and lesson, newest first, honouring hides", () => {
    const card = (id: number, createdAt: number) => ({
      id,
      sessionId: `s${id}`,
      sessionName: `Session ${id}`,
      workspaceId: "w1",
      kind: "lesson" as const,
      title: `Lesson ${id}`,
      destination: null,
      createdAt,
    });
    const items = needsYouItems({
      asks: [],
      questions: [],
      dismissed: ["card:3"],
      cards: [card(1, 100), card(2, 200), card(3, 300)],
    });
    expect(items.map((i) => i.key)).toEqual(["card:2", "card:1"]);
    expect(items[0]).toMatchObject({
      kind: "card",
      title: "Lesson 2",
      sub: "Session 2",
    });
  });
});
