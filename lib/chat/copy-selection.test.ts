import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import { formatTranscript, sourceText, speakerOf } from "./copy-selection";

const user = (text: string, extra: object = {}): ChatItem =>
  ({
    id: "u",
    kind: "user",
    createdAt: 0,
    text,
    tagged: true,
    ...extra,
  }) as ChatItem;
const assistant = (text: string): ChatItem => ({
  id: "a",
  kind: "assistant",
  createdAt: 0,
  text,
});

describe("formatTranscript", () => {
  it("labels each speaker and separates messages with a blank line", () => {
    expect(
      formatTranscript([
        { speaker: "User", text: "fix the bug" },
        { speaker: "Assistant", text: "Done.\n\nTwo files." },
        { speaker: "User", text: "thanks" },
      ])
    ).toBe(
      "User:\nfix the bug\n\nAssistant:\nDone.\n\nTwo files.\n\nUser:\nthanks"
    );
  });

  it("trims, drops empty messages and merges same-speaker neighbours", () => {
    expect(
      formatTranscript([
        { speaker: "Assistant", text: "  one \n" },
        { speaker: "User", text: "   " },
        { speaker: "Assistant", text: "two" },
      ])
    ).toBe("Assistant:\none\n\ntwo");
  });

  it("is empty for nothing", () => {
    expect(formatTranscript([])).toBe("");
  });
});

describe("speakerOf", () => {
  it("names typed messages, replies and errors", () => {
    expect(speakerOf(user("hi"))).toBe("User");
    expect(speakerOf(assistant("hello"))).toBe("Assistant");
    expect(
      speakerOf({ id: "e", kind: "error", createdAt: 0, message: "boom" })
    ).toBe("Error");
  });

  it("names a message another session or the system sent by its sender", () => {
    expect(
      speakerOf(user("hey", { origin: { kind: "peer", label: "builder" } }))
    ).toBe("builder");
  });

  it("skips rows that aren't messages", () => {
    expect(
      speakerOf({ id: "t", kind: "turn_end", createdAt: 0 } as ChatItem)
    ).toBeNull();
  });
});

describe("sourceText", () => {
  it("is the text as written", () => {
    expect(sourceText(user("a **b**"))).toBe("a **b**");
    expect(sourceText(assistant("`x`"))).toBe("`x`");
  });
});
