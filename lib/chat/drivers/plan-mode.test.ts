import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { DriverEvent } from "../events";
import {
  Approvals,
  isPlanFile,
  proposedPlan,
  sdkMode,
} from "./claude-approvals";

describe("sdkMode", () => {
  it("is plan while plan mode is on, whatever the access", () => {
    expect(sdkMode("full", true)).toBe("plan");
    expect(sdkMode("ask", true)).toBe("plan");
  });

  it("goes back to the access setting when plan mode is off", () => {
    expect(sdkMode("ask", false)).toBe("default");
    expect(sdkMode("edits", false)).toBe("acceptEdits");
    expect(sdkMode("full", false)).toBe("bypassPermissions");
  });
});

describe("proposePlan", () => {
  const run = async (toolInput: unknown) => {
    const events: DriverEvent[] = [];
    const approvals = new Approvals((e) => events.push(e));
    const out = await approvals.proposePlan(
      {
        hook_event_name: "PreToolUse",
        tool_name: "ExitPlanMode",
        tool_input: toolInput,
        tool_use_id: "t9",
      } as Parameters<Approvals["proposePlan"]>[0],
      "t9",
      { signal: new AbortController().signal }
    );
    return { events, out };
  };

  it("turns the proposed plan into a plan card and keeps plan mode", async () => {
    const { events, out } = await run({ plan: "# Plan\n1. Do it" });
    expect(events).toEqual([
      {
        type: "item",
        item: expect.objectContaining({
          id: "plan-t9",
          kind: "plan",
          plan: "# Plan\n1. Do it",
        }),
      },
    ]);
    expect(out).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
  });

  it("leaves a call without a plan to the agent", async () => {
    const { events, out } = await run({});
    expect(events).toEqual([]);
    expect(out).toEqual({});
  });
});

describe("proposedPlan", () => {
  it("reads the plan file when the call doesn't carry the plan", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plans-"));
    const file = path.join(dir, ".claude", "plans", "quiet-otter.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# From the file");
    expect(isPlanFile(file)).toBe(true);
    expect(proposedPlan({}, file)).toBe("# From the file");
    expect(proposedPlan({ plan: "# Inline" }, file)).toBe("# Inline");
    // A path the call names is the model's: never read.
    expect(proposedPlan({ planFilePath: file })).toBeNull();
    expect(proposedPlan({}, path.join(dir, "missing.md"))).toBeNull();
    expect(proposedPlan({})).toBeNull();
  });

  it("reads only a regular plan file, and no more than a plan needs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plans-"));
    const plans = path.join(dir, ".claude", "plans");
    fs.mkdirSync(plans, { recursive: true });
    const secret = path.join(dir, "secret.key");
    fs.writeFileSync(secret, "hunter2");
    const link = path.join(plans, "link.md");
    fs.symlinkSync(secret, link);
    expect(proposedPlan({}, link)).toBeNull();
    const big = path.join(plans, "big.md");
    fs.writeFileSync(big, "x".repeat(300 * 1024));
    expect(proposedPlan({}, big)!.length).toBeLessThan(260 * 1024);
    expect(proposedPlan({ plan: "y".repeat(300 * 1024) })!.length).toBeLessThan(
      260 * 1024
    );
  });

  it("never reads a file the call names that isn't a plan file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plans-"));
    const secret = path.join(dir, "secret.key");
    fs.writeFileSync(secret, "hunter2");
    expect(proposedPlan({ planFilePath: secret })).toBeNull();
    expect(proposedPlan({ planFilePath: "/repo/docs/plans/x.md" })).toBeNull();
  });

  it("knows a plan file from other markdown", () => {
    expect(isPlanFile("/Users/x/.claude/plans/a-b.md")).toBe(true);
    expect(isPlanFile("/repo/.claude/plans/a-b.md")).toBe(true);
    expect(isPlanFile("/repo/README.md")).toBe(false);
    expect(isPlanFile("/repo/docs/plans/x.md")).toBe(false);
    expect(isPlanFile("/Users/x/.claude/plans/sub/x.md")).toBe(false);
  });
});
