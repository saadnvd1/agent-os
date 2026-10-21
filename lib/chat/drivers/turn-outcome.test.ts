import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announcesAction,
  hasToolMarkup,
  logTurnEnd,
  turnOutcome,
} from "./turn-outcome";

afterEach(() => vi.restoreAllMocks());

describe("announcesAction", () => {
  it.each([
    "First, let me run typecheck.",
    "The tests are red. I'll start by reading the failing file:",
    "Understood. Now I will update the config",
    "Here is the plan:",
  ])("catches %s", (text) => expect(announcesAction(text)).toBe(true));

  it.each([
    "Done. Everything passes. Let me know if you want more.",
    "Want me to run the tests?",
    "The change is in lib/a.ts and typecheck is clean.",
    "",
  ])("lets %s through", (text) => expect(announcesAction(text)).toBe(false));
});

describe("turnOutcome", () => {
  const base = { text: "", toolCalls: 0 };

  it("names each way a turn stops short", () => {
    expect(
      turnOutcome({ ...base, finishReason: "length", text: "partial" })?.reason
    ).toBe("length");
    expect(turnOutcome({ ...base, error: "boom" })?.reason).toBe("error");
    expect(
      turnOutcome({ ...base, text: '<tool_call>{"name":"bash"' })?.reason
    ).toBe("parse_failure");
    expect(turnOutcome({ ...base, finishReason: "stop" })?.reason).toBe(
      "empty"
    );
    const none = turnOutcome({ ...base, text: "First, let me run typecheck." });
    expect(none?.reason).toBe("no_tool_call");
    expect(none?.notice).toContain("without calling a tool");
    expect(none?.notice).toContain("--jinja");
    expect(none?.notice).toContain("--tool-call-parser");
    expect(none?.notice).toContain("LM Studio");
  });

  it("is quiet when the model finished or acted", () => {
    expect(
      turnOutcome({ ...base, text: "All done, tests pass." })
    ).toBeUndefined();
    expect(
      turnOutcome({
        text: "Let me run it.",
        toolCalls: 1,
        finishReason: "stop",
      })
    ).toBeUndefined();
  });
});

describe("hasToolMarkup", () => {
  it("sees written calls", () => {
    expect(hasToolMarkup("<function=bash>")).toBe(true);
    expect(hasToolMarkup('ok {"name": "bash", "arguments": {"a": 1}}')).toBe(
      true
    );
    expect(hasToolMarkup("plain prose")).toBe(false);
  });
});

describe("logTurnEnd", () => {
  it("logs where and why, with the tail scrubbed and cut", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const key = ["sk", "-", "a1B2c3D4".repeat(4)].join("");
    logTurnEnd({
      driver: "pi",
      provider: "stub",
      model: "qwen",
      api: "openai-completions",
      finishReason: "stop",
      reason: "no_tool_call",
      text: `${"x".repeat(500)} key ${key}\nlet me run it`,
    });
    const [label, json] = warn.mock.calls[0] as [string, string];
    expect(label).toContain("turn ended early");
    const line = JSON.parse(json);
    expect(line).toMatchObject({
      driver: "pi",
      provider: "stub",
      model: "qwen",
      finishReason: "stop",
      reason: "no_tool_call",
    });
    expect(line.tail.length).toBeLessThanOrEqual(240);
    expect(json).not.toContain(key);
    expect(line).not.toHaveProperty("prompt");
  });
});
