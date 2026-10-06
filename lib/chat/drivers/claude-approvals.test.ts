import { describe, expect, it } from "vitest";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { DriverEvent } from "../events";
import { Approvals } from "./claude-approvals";

function setup() {
  const events: DriverEvent[] = [];
  const approvals = new Approvals((e) => events.push(e));
  const ask = (name: string, input: Record<string, unknown>, extra = {}) => {
    const controller = new AbortController();
    const result = approvals.canUseTool(name, input, {
      signal: controller.signal,
      toolUseID: "t1",
      requestId: "r1",
      ...extra,
    } as Parameters<CanUseTool>[2]);
    return { result, controller };
  };
  const items = () =>
    events.flatMap((e) => (e.type === "item" ? [e.item] : []));
  const states = () =>
    events.flatMap((e) => (e.type === "state" ? [e.state] : []));
  return { approvals, ask, items, states };
}

describe("Approvals", () => {
  it("shows a pending card and lets the tool through on allow", async () => {
    const { approvals, ask, items, states } = setup();
    const { result } = ask("Bash", { command: "ls" });
    expect(items()[0]).toMatchObject({
      id: "approval-t1",
      status: "pending",
      title: "ls",
    });
    expect(states()).toEqual(["waiting"]);
    approvals.respond("approval-t1", { decision: "allow" });
    expect(await result).toMatchObject({
      behavior: "allow",
      updatedInput: { command: "ls" },
    });
    expect(items().at(-1)).toMatchObject({ status: "allowed" });
    expect(states()).toEqual(["waiting", "running"]);
  });

  it("offers always-allow only with suggestions, and passes them on", async () => {
    const { approvals, ask, items } = setup();
    const suggestions = [
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ];
    const { result } = ask("Edit", { file_path: "/a" }, { suggestions });
    expect(items()[0]).toMatchObject({ canAlways: true });
    approvals.respond("approval-t1", { decision: "always" });
    expect(await result).toMatchObject({ updatedPermissions: suggestions });
  });

  it("answers questions through the tool's input", async () => {
    const { approvals, ask, items } = setup();
    const questions = [
      { question: "Which?", header: "Pick", multiSelect: false, options: [] },
    ];
    const { result } = ask("AskUserQuestion", { questions });
    expect(items()[0]).toMatchObject({ questions, canAlways: false });
    approvals.respond("approval-t1", {
      decision: "answer",
      answers: { "Which?": "A" },
    });
    expect(await result).toMatchObject({
      behavior: "allow",
      updatedInput: { questions, answers: { "Which?": "A" } },
    });
    expect(items().at(-1)).toMatchObject({
      status: "answered",
      input: { answers: { "Which?": "A" } },
    });
  });

  it("expires a card when the turn is stopped", async () => {
    const { ask, items } = setup();
    const { result, controller } = ask("Bash", { command: "rm" });
    controller.abort();
    expect(await result).toMatchObject({ behavior: "deny" });
    expect(items().at(-1)).toMatchObject({ status: "expired" });
  });

  it("asks questions through the hook, whatever the access level", async () => {
    const { approvals, items } = setup();
    const questions = [
      { question: "Which?", header: "Pick", multiSelect: false, options: [] },
    ];
    const out = approvals.askQuestions(
      {
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: { questions },
        tool_use_id: "t9",
      } as Parameters<typeof approvals.askQuestions>[0],
      "t9",
      { signal: new AbortController().signal }
    );
    expect(items()[0]).toMatchObject({ id: "approval-t9", questions });
    approvals.respond("approval-t9", {
      decision: "answer",
      answers: { "Which?": "A" },
    });
    expect(await out).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "allow",
        updatedInput: { answers: { "Which?": "A" } },
      },
    });
    // The permission check that follows lets the answered call straight through.
    expect(
      await approvals.canUseTool(
        "AskUserQuestion",
        { questions, answers: { "Which?": "A" } },
        { signal: new AbortController().signal } as Parameters<CanUseTool>[2]
      )
    ).toMatchObject({ behavior: "allow" });
    expect(items()).toHaveLength(2);
  });
});
