import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announcesAction,
  failureReport,
  hasToolMarkup,
  logTurnEnd,
  needsSummary,
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

describe("needsSummary", () => {
  const ran = { toolsRun: 3, text: "", toolCalls: 0 };

  it.each([
    ["an empty last reply", ""],
    ["a lead-in ending in a colon", "Here's what I can verify is reachable:"],
    ["an announced next step", "Let me summarize what I found"],
  ])("asks after tools and %s", (_, text) =>
    expect(needsSummary({ ...ran, text })).toBe(true)
  );

  it.each([
    ["no tools ran", { toolsRun: 0 }],
    [
      "the reply is a real summary",
      { text: "API: 200. DB: refused (exit 7)." },
    ],
    ["the turn was stopped", { aborted: true }],
    ["the model errored", { error: "boom" }],
    ["it hit the output limit", { finishReason: "length" }],
    ["the last reply still made calls", { toolCalls: 1 }],
  ])("doesn't when %s", (_, over) =>
    expect(needsSummary({ ...ran, ...over })).toBe(false)
  );
});

describe("failureReport", () => {
  const HEADERS = "Provider response headers timed out after 300000ms";
  const summary = {
    steps: 4,
    failed: 2,
    files: [{ path: "src/applier/sources.ts", ok: 0, failed: 2 }],
  };

  it("says what finished, what didn't, and how to go on", () => {
    const text = failureReport({ error: HEADERS, retries: 3, summary });
    expect(text).toContain("timed out");
    expect(text).toContain(HEADERS);
    expect(text).toContain("3 retries didn't get through");
    expect(text).toContain("4 tool steps (2 failed)");
    expect(text).toContain("src/applier/sources.ts (2 failed)");
    expect(text).toContain("Not finished");
    expect(text).toContain('Send "continue"');
  });

  it("says so when nothing had finished, or the agent retried", () => {
    const text = failureReport({
      error: HEADERS,
      retries: 0,
      agentRetried: true,
    });
    expect(text).toContain("Nothing had finished yet.");
    expect(text).toContain("even after the agent retried it");
  });

  it("scrubs a secret out of the error", () => {
    const key = ["sk", "-", "a1B2c3D4e5F6".repeat(4)].join("");
    const text = failureReport({
      error: `fetch failed for key ${key}`,
      retries: 1,
    });
    expect(text).not.toContain(key);
  });

  it("replaces the bare notice for a transient error only", () => {
    const base = { text: "", toolCalls: 0 };
    expect(
      turnOutcome({ ...base, error: HEADERS, retries: 3, summary })?.notice
    ).toContain("Not finished");
    expect(turnOutcome({ ...base, error: "400 bad request" })?.notice).toBe(
      "The model's server returned an error, shown above."
    );
  });
});
