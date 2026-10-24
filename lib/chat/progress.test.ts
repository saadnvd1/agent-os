import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import {
  LONG_WAIT_HINT,
  currentActivity,
  phaseOf,
  shortModel,
  stepLabel,
} from "./progress";

type Tool = Extract<ChatItem, { kind: "tool" }>;
let n = 0;
const tool = (
  name: string,
  input: Record<string, unknown>,
  status: Tool["status"] = "done",
  extra: Partial<Tool> = {}
): Tool => ({
  id: `t${n++}`,
  kind: "tool",
  name,
  title: `${name} ${String(input.file_path ?? "")}`.trim(),
  input,
  status,
  createdAt: 100 + n,
  ...extra,
});
const bash = (command: string, status: Tool["status"] = "done") =>
  tool("Bash", { command }, status, { title: "desc" });
const user = (createdAt = 50, midTurn?: boolean): ChatItem => ({
  id: `u${n++}`,
  kind: "user",
  text: "go",
  createdAt,
  midTurn,
});

describe("currentActivity waiting on the model", () => {
  it("names the model, the call's own clock and the measured prompt", () => {
    const a = currentActivity(
      [user()],
      "running",
      null,
      { since: 900, promptTokens: 48_000 },
      "ollama/qwen3-coder:30b",
      1000
    );
    expect(a).toMatchObject({
      label: "Waiting for qwen3-coder:30b",
      kind: "waiting",
      since: 900,
      tokens: 48_000,
    });
    expect(a?.hint).toBeUndefined();
  });

  it("invents no prompt size, and falls back to the last step's end", () => {
    const done = bash("npm test");
    done.endedAt = 700;
    const a = currentActivity(
      [user(), done],
      "running",
      null,
      null,
      "Opus 4.1"
    );
    expect(a?.tokens).toBeUndefined();
    expect(a?.since).toBe(700);
    expect(a?.label).toBe("Waiting for Opus 4.1");
  });

  it("hints after two minutes on one call", () => {
    const wait = { since: 0 };
    expect(
      currentActivity([user()], "running", null, wait, "m", 119_000)?.hint
    ).toBeUndefined();
    expect(
      currentActivity([user()], "running", null, wait, "m", 121_000)?.hint
    ).toBe(LONG_WAIT_HINT);
  });

  it("shows a retry", () => {
    const a = currentActivity(
      [user()],
      "running",
      null,
      { since: 5, retry: { attempt: 2 } },
      "m"
    );
    expect(a).toMatchObject({
      label: "Retrying model request (attempt 2)",
      kind: "retry",
    });
  });
});

describe("currentActivity with work going on", () => {
  it("shows the running tool in words, with the turn's step count", () => {
    const old = bash("echo before");
    const items = [
      old,
      user(60),
      tool("Read", { file_path: "/a/b.ts" }),
      user(70, true),
      bash("npm test", "running"),
    ];
    const a = currentActivity(items, "running");
    expect(a).toMatchObject({
      label: "Running npm test",
      kind: "tool",
      steps: 2,
      phase: "testing",
    });
  });

  it("says Writing or Thinking while streaming", () => {
    const text: ChatItem = {
      id: "a",
      kind: "reasoning",
      text: "",
      streaming: true,
      createdAt: 1,
    };
    expect(currentActivity([user(), text], "running")?.label).toBe("Thinking");
  });

  it("keeps the waiting-for-you and idle cases", () => {
    expect(currentActivity([], "waiting")?.label).toBe(
      "Waiting for your answer"
    );
    expect(currentActivity([], "idle")).toBeNull();
  });

  it("names a failed last step while waiting", () => {
    const a = currentActivity(
      [user(), bash("npm run build", "error")],
      "running",
      null,
      { since: 9 },
      "m"
    );
    expect(a).toMatchObject({
      phase: "error",
      lastStep: "Running npm run build failed",
    });
  });
});

describe("phaseOf", () => {
  it("is planning until something edits", () => {
    expect(phaseOf([])).toBe("planning");
    expect(phaseOf([tool("Read", { file_path: "a" }), bash("ls src")])).toBe(
      "planning"
    );
  });
  it("is coding once the turn has edited, even on a later look", () => {
    expect(phaseOf([tool("Edit", { file_path: "a" }), bash("ls src")])).toBe(
      "coding"
    );
  });
  it("is testing for test and build commands", () => {
    for (const c of [
      "npx vitest run x",
      "npm run typecheck",
      "cargo test",
      "pytest -q",
      "go build ./...",
    ])
      expect(phaseOf([bash(c)])).toBe("testing");
  });
  it("is error when the current step failed", () => {
    expect(
      phaseOf([tool("Edit", { file_path: "a" }), bash("npm test", "error")])
    ).toBe("error");
  });
});

describe("stepLabel and shortModel", () => {
  it("reads steps in plain words", () => {
    expect(
      stepLabel(tool("Edit", { file_path: "/w/proj/src/applier/sources.ts" }))
    ).toBe("Editing src/applier/sources.ts");
    expect(stepLabel(bash("npm   test"))).toBe("Running npm test");
    expect(
      stepLabel(tool("Grep", { pattern: "x" }, "done", { title: 'Search "x"' }))
    ).toBe('Searching "x"');
  });
  it("shortens model names", () => {
    expect(shortModel("ollama/qwen3-coder:latest")).toBe("qwen3-coder");
    expect(shortModel("claude-sonnet-4-20250514")).toBe("claude-sonnet-4");
    expect(shortModel("")).toBe("the model");
    expect(shortModel(undefined)).toBe("the model");
  });
});
