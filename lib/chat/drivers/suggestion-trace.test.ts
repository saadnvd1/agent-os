import { describe, it, expect } from "vitest";
import type { ClaudeMessage } from "./claude-mapper";
import { SuggestionTrace } from "./suggestion-trace";

function setup(plan = false) {
  const lines: string[] = [];
  let t = 0;
  const trace = new SuggestionTrace(
    (l) => lines.push(l),
    () => plan,
    () => t
  );
  return { trace, lines, at: (ms: number) => (t = ms) };
}

const reply = (cacheWrite = 0): ClaudeMessage => ({
  type: "assistant",
  message: {
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: cacheWrite,
    },
  },
});

describe("SuggestionTrace", () => {
  it("logs a guess with the turn it follows", () => {
    const { trace, lines, at } = setup();
    trace.sent();
    trace.message({ type: "result" });
    at(4200);
    trace.message({ type: "prompt_suggestion", suggestion: "run the tests" });
    expect(lines).toEqual([
      '[suggestion] turn 1, 4.2s after it ended: "run the tests"',
    ]);
  });

  it("keeps a secret the guess repeats out of the log", () => {
    const fake = "ghp_" + "a".repeat(36);
    const { trace, lines } = setup();
    trace.sent();
    trace.message({ type: "result" });
    trace.message({
      type: "prompt_suggestion",
      suggestion: `push with GITHUB_TOKEN=${fake}`,
    });
    expect(lines[0]).not.toContain(fake);
    expect(lines[0]).toContain("[redacted]");
  });

  it("logs a turn with no guess when the next message goes in", () => {
    const { trace, lines, at } = setup();
    trace.sent();
    trace.message(reply(12000));
    trace.message({ type: "result" });
    at(1500);
    trace.sent();
    expect(lines).toEqual([
      "[suggestion] none for turn 1: a message was sent 1.5s after it ended (first turn of this process; last reply in 10, out 20, cache write 12000)",
    ]);
  });

  it("says what else was going on", () => {
    const { trace, lines } = setup(true);
    trace.message({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed_warning" },
    } as never);
    trace.message({ type: "result", is_error: true });
    trace.message({ type: "result" });
    trace.closed();
    expect(lines).toEqual([
      "[suggestion] rate limit now allowed_warning",
      "[suggestion] none for turn 1: the next turn ended first 0.0s after it ended (first turn of this process; the turn failed; a turn the agent started; plan mode; rate limit allowed_warning)",
      "[suggestion] none for turn 2: the agent was closed 0.0s after it ended (a turn the agent started; plan mode; rate limit allowed_warning)",
    ]);
  });

  it("ignores a subagent's traffic and logs each turn once", () => {
    const { trace, lines } = setup();
    trace.sent();
    trace.message({ type: "result", parent_tool_use_id: "t1" });
    trace.sent();
    trace.message({ type: "result" });
    trace.message({ type: "prompt_suggestion", suggestion: "go" });
    trace.sent();
    trace.closed();
    expect(lines).toEqual(['[suggestion] turn 1, 0.0s after it ended: "go"']);
  });
});
