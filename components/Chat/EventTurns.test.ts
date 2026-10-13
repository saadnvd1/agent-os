import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/events";
import { eventTurnAt } from "@/lib/chat/turns";
import { EventGroup } from "./EventTurns";

const turn = (id: string, task: string, text: string) => {
  const items: ChatItem[] = [
    {
      id,
      kind: "user",
      text: "PR opened",
      tagged: true,
      createdAt: Date.now(),
      origin: {
        kind: "event",
        label: "AgentOS",
        subjects: [{ id: "s", name: task }],
      },
    },
    { id: `${id}-a`, kind: "assistant", text, createdAt: Date.now() },
    { id: `${id}-t`, kind: "turn_end", createdAt: Date.now() },
  ];
  return eventTurnAt(items, 0)!.turn;
};

const render = (turns: ReturnType<typeof turn>[]) =>
  renderToStaticMarkup(
    createElement(EventGroup, {
      id: "g",
      turns,
      renderReplies: () => "FULL-REPLY-BODY",
    })
  );

describe("EventGroup", () => {
  it("shows one line for a turn: task and how the reply starts, not the reply", () => {
    const html = render([turn("e1", "billing", "Merged #88.\n\nMore detail.")]);
    expect(html).toContain("billing");
    expect(html).toContain("Merged #88.");
    expect(html).not.toContain("FULL-REPLY-BODY");
    expect(html).not.toContain("More detail");
  });

  it("folds several into a count, collapsed", () => {
    const html = render([
      turn("e1", "billing", "one"),
      turn("e2", "api", "two"),
      turn("e3", "web", "three"),
    ]);
    expect(html).toContain("3 updates");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("FULL-REPLY-BODY");
  });
});
