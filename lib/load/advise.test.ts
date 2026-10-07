import { describe, expect, it } from "vitest";
import { hookOutput } from "./advise";
import { heavyRegistry } from "./monitor";

const bash = (id: string, command: string, extra = {}) => ({
  tool_name: "Bash",
  tool_use_id: id,
  tool_input: { command, ...extra },
});

describe("the heavy-command hook's answer", () => {
  it("says nothing for a light command, another tool, or nothing else running", () => {
    expect(hookOutput("PreToolUse", null, bash("t0", "git status"))).toBe("");
    expect(hookOutput("PreToolUse", null, { tool_name: "Read" })).toBe("");
    expect(hookOutput("PreToolUse", null, bash("t1", "npx vitest run"))).toBe(
      ""
    );
    expect(
      heavyRegistry()
        .active()
        .map((r) => r.key)
    ).toContain("tool:t1");
  });

  it("tells the next heavy command what is already running", () => {
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
    hookOutput("PostToolUse", null, bash("t2", "npx tsc --noEmit"));
    hookOutput(
      "PostToolUse",
      null,
      bash("t1", "npx vitest run", { run_in_background: true })
    );
    expect(
      heavyRegistry()
        .active()
        .map((r) => r.key)
    ).toEqual(["tool:t1"]);
    heavyRegistry().finish("tool:t1");
  });
});
