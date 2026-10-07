import { describe, expect, it } from "vitest";
import { HeavyRegistry, STALE_MS, heavyLabel, heavyNote } from "./heavy";

describe("heavy commands", () => {
  it.each([
    ["npx vitest run", "vitest"],
    ["cd web && npx vitest", "vitest"],
    ["CI=1 ./node_modules/.bin/vitest run --reporter=dot", "vitest"],
    ["npx tsc --noEmit", "tsc"],
    ["npm run typecheck", "tsc"],
    ["npm test", "test suite"],
    ["npm run lint", "eslint"],
    ["npx eslint .", "eslint"],
    ["npx next build", "next build"],
    ["xcodebuild -scheme App test", "xcodebuild"],
    ["python -m pytest -q", "pytest"],
    ["pytest", "pytest"],
  ])("knows %s is heavy", (cmd, label) => {
    expect(heavyLabel(cmd)).toBe(label);
  });

  it.each([
    "npx vitest run lib/load/heavy.test.ts",
    "npx vitest run heavy",
    "npm test -- lib/x.test.ts",
    "npx eslint lib/foo.ts",
    "pytest tests/test_x.py",
    "npm install",
    "git status",
    "echo tsc",
    "npx tsc --version",
  ])("leaves %s alone", (cmd) => {
    expect(heavyLabel(cmd)).toBeNull();
  });

  it("forgets runs whose process exited, and tool calls gone stale", () => {
    let now = 0;
    const alive = new Set([100]);
    const reg = new HeavyRegistry(
      () => now,
      (pid) => alive.has(pid)
    );
    const base = { sessionId: "s", sessionName: "s", label: "vitest" };
    reg.add({ ...base, key: "pid:100", pid: 100 });
    reg.add({ ...base, key: "tool:a", pid: null });
    expect(reg.active()).toHaveLength(2);
    alive.delete(100);
    expect(reg.active().map((r) => r.key)).toEqual(["tool:a"]);
    now = STALE_MS + 1;
    expect(reg.active()).toEqual([]);
  });

  it("says nothing when it's alone and the load isn't red", () => {
    expect(heavyNote([], "amber")).toBeNull();
    expect(heavyNote([], null)).toBeNull();
  });

  it("names what else is running, and the load", () => {
    const run = (name: string, label: string) => ({
      key: name,
      sessionId: name,
      sessionName: name,
      label,
      pid: null,
      startedAt: 0,
    });
    expect(heavyNote([run("api", "vitest"), run("web", "tsc")], "red")).toBe(
      "Note: 2 heavy commands already running (session api: vitest, session web: tsc); load is red. Prefer targeted tests or wait."
    );
    expect(heavyNote([], "red")).toBe(
      "Note: load is red. Prefer targeted tests or wait."
    );
  });
});
