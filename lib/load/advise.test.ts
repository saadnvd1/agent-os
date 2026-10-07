import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookOutput } from "./advise";
import { MAX_RUNS } from "./heavy";
import { heavyRegistry } from "./monitor";

const bash = (id: string, command: string, extra = {}) => ({
  tool_name: "Bash",
  tool_use_id: id,
  tool_input: { command, ...extra },
});
const keys = () =>
  heavyRegistry()
    .active()
    .map((r) => r.key);
const clear = () => keys().forEach((k) => heavyRegistry().finish(k));

beforeEach(clear);
afterEach(() => {
  clear();
  delete process.env.AGENTOS_LOAD;
});

describe("the heavy-command hook's answer", () => {
  it("says nothing for a light command, another tool, or nothing else running", () => {
    expect(hookOutput("PreToolUse", null, bash("t0", "git status"))).toBe("");
    expect(hookOutput("PreToolUse", null, { tool_name: "Read" })).toBe("");
    expect(hookOutput("PreToolUse", null, bash("t1", "npx vitest run"))).toBe(
      ""
    );
    expect(keys()).toEqual(["tool:t1"]);
  });

  it("tells the next heavy command what is already running", () => {
    hookOutput("PreToolUse", null, bash("t1", "npx vitest run"));
    const out = JSON.parse(
      hookOutput("PreToolUse", null, bash("t2", "npx tsc --noEmit"))
    );
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.additionalContext).toMatch(
      /^Note: 1 heavy command already running \(outside a session: vitest\)/
    );
    expect(out.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });

  it("forgets a call when it returns, but not a background one", () => {
    hookOutput("PreToolUse", null, bash("t1", "npx vitest run"));
    hookOutput("PreToolUse", null, bash("t2", "npx tsc --noEmit"));
    hookOutput("PostToolUse", null, bash("t2", "npx tsc --noEmit"));
    hookOutput(
      "PostToolUse",
      null,
      bash("t1", "npx vitest run", { run_in_background: true })
    );
    expect(keys()).toEqual(["tool:t1"]);
  });

  it("holds a bounded number of runs, whatever ids arrive", () => {
    for (let i = 0; i < MAX_RUNS + 50; i++)
      hookOutput("PreToolUse", null, bash(`id${i}`, "npx vitest run"));
    hookOutput("PreToolUse", null, bash("x".repeat(5000), "npx vitest run"));
    expect(keys()).toHaveLength(MAX_RUNS);
    expect(keys().every((k) => k.length < 120)).toBe(true);
    expect(keys()).not.toContain("tool:id0");
  });

  it("does nothing with AGENTOS_LOAD=off", () => {
    process.env.AGENTOS_LOAD = "off";
    hookOutput("PreToolUse", null, bash("t1", "npx vitest run"));
    expect(hookOutput("PreToolUse", null, bash("t2", "npx tsc"))).toBe("");
    expect(keys()).toEqual([]);
  });
});
