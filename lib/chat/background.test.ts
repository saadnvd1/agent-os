import { describe, expect, it } from "vitest";
import {
  backgroundable,
  backgroundFailure,
  outputTail,
  outputLines,
  exitCode,
  taskLife,
  QUIET_AFTER_MS,
} from "./background";

const tool = { status: "running" as const, createdAt: 1000 };
const fg = { status: "running" as const, backgrounded: false };

describe("backgroundable", () => {
  it("is offered for a running call that blocks the turn, after a few seconds", () => {
    expect(backgroundable(true, tool, fg, 4000)).toBe(true);
  });

  it("is not offered before the delay, so quick commands never flash it", () => {
    expect(backgroundable(true, tool, fg, 3999)).toBe(false);
  });

  it("is not offered when the agent can't, there is no task yet, or it already moved", () => {
    expect(backgroundable(false, tool, fg, 9000)).toBe(false);
    expect(backgroundable(true, tool, undefined, 9000)).toBe(false);
    expect(
      backgroundable(
        true,
        tool,
        { status: "running", backgrounded: true },
        9000
      )
    ).toBe(false);
    expect(backgroundable(true, tool, { status: "running" }, 9000)).toBe(false);
  });

  it("is not offered once the call or its task has finished", () => {
    expect(backgroundable(true, { ...tool, status: "done" }, fg, 9000)).toBe(
      false
    );
    expect(
      backgroundable(
        true,
        tool,
        { status: "completed", backgrounded: false },
        9000
      )
    ).toBe(false);
  });
});

describe("backgroundFailure", () => {
  it("says nothing when it worked", () => {
    expect(backgroundFailure({ ok: true }, tool, fg)).toBeNull();
  });

  it("says why when nothing moved", () => {
    expect(
      backgroundFailure({ ok: false }, { status: "done" }, undefined)
    ).toBe("That step already finished");
    expect(backgroundFailure({ ok: false }, tool, { backgrounded: true })).toBe(
      "Already running in the background"
    );
    expect(backgroundFailure({ ok: false }, tool, fg)).toMatch(/yet/);
  });

  it("tells a request that never arrived from a refusal", () => {
    for (const error of ["timeout", "unavailable", "unsupported"])
      expect(backgroundFailure({ ok: false, error }, tool, fg)).toMatch(
        /reach the agent/
      );
    expect(
      backgroundFailure({ ok: false, error: "disabled" }, tool, fg)
    ).toMatch(/turned off/);
  });
});

describe("outputTail", () => {
  it("is the last line with anything on it", () => {
    expect(outputTail("a\nb  \n\n  \n")).toBe("b");
    expect(outputTail("")).toBeNull();
    expect(outputTail(null)).toBeNull();
  });
});

describe("outputLines", () => {
  it("keeps the last non-empty lines, oldest first", () => {
    expect(outputLines("a\nb\n\nc\nd\ne\n", 3)).toEqual(["c", "d", "e"]);
    expect(outputLines(null)).toEqual([]);
  });
});

describe("exitCode", () => {
  it("reads the code from the agent's note", () => {
    expect(exitCode('Background command "x" failed with exit code 65')).toBe(
      65
    );
    expect(exitCode('Background command "x" completed (exit code 0)')).toBe(0);
    expect(exitCode("done")).toBeNull();
    expect(exitCode(undefined)).toBeNull();
  });
});

describe("taskLife", () => {
  const task = {
    status: "running" as const,
    createdAt: 1000,
    summary: undefined,
  };
  it("is active while output is recent", () => {
    const out = { text: "x", updatedAt: 10_000 };
    expect(taskLife(task, out, 10_000 + QUIET_AFTER_MS - 1).state).toBe(
      "active"
    );
  });
  it("goes quiet at the threshold, counting from the start with no output", () => {
    expect(taskLife(task, null, 1000 + QUIET_AFTER_MS)).toEqual({
      state: "quiet",
      idleMs: QUIET_AFTER_MS,
    });
    const out = { text: "x", updatedAt: 5000 };
    expect(taskLife(task, out, 5000 + QUIET_AFTER_MS).state).toBe("quiet");
  });
  it("shows an ended task as exited with its code", () => {
    const failed = {
      ...task,
      status: "failed" as const,
      summary: "failed with exit code 65",
    };
    expect(taskLife(failed, null, 99)).toEqual({
      state: "exited",
      code: 65,
      failed: true,
    });
    const ok = { ...task, status: "completed" as const };
    expect(taskLife(ok, null, 99)).toEqual({
      state: "exited",
      code: 0,
      failed: false,
    });
  });
});
