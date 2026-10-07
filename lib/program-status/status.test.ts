import { describe, expect, it } from "vitest";
import { programStatusRow } from "../needs-you";
import type { ProgramSummary } from "./records";

const seen = {
  id: "s",
  view: "terminal" as const,
  updated_at: "2026-10-06 12:00:00",
  last_seen_at: "2026-10-06 11:00:00",
};
const p = (s: Partial<ProgramSummary>): ProgramSummary => ({
  state: "idle",
  at: 1,
  ...s,
});

describe("programStatusRow", () => {
  it("puts blocked on Needs you with a badge from its kind and its message", () => {
    expect(
      programStatusRow(
        seen,
        p({ state: "blocked", kind: "permission", msg: "Apply 3 changes?" })
      )
    ).toMatchObject({
      status: "waiting",
      need: "approve",
      detail: "Apply 3 changes?",
    });
    expect(
      programStatusRow(seen, p({ state: "blocked", kind: "question" })).need
    ).toBe("answer");
    expect(
      programStatusRow(seen, p({ state: "blocked", kind: "auth" })).need
    ).toBe("signin");
    expect(programStatusRow(seen, p({ state: "blocked" })).need).toBe("input");
  });

  it("needs you while blocked even after you've seen it", () => {
    const looked = { ...seen, last_seen_at: "2026-10-06 13:00:00" };
    expect(programStatusRow(looked, p({ state: "blocked" })).status).toBe(
      "waiting"
    );
  });

  it("shows working with its progress", () => {
    expect(
      programStatusRow(seen, p({ state: "working", progress: 40 }))
    ).toMatchObject({
      status: "running",
      need: null,
      detail: "40%",
      progress: 40,
    });
    expect(
      programStatusRow(
        seen,
        p({ state: "working", msg: "Building", progress: 5 })
      ).detail
    ).toBe("Building · 5%");
  });

  it("marks done unread until seen", () => {
    expect(programStatusRow(seen, p({ state: "done" }))).toMatchObject({
      status: "idle",
      need: null,
      unread: true,
    });
    const looked = { ...seen, last_seen_at: "2026-10-06 13:00:00" };
    expect(programStatusRow(looked, p({ state: "done" })).unread).toBe(false);
  });

  it("shows error as Failed", () => {
    expect(
      programStatusRow(seen, p({ state: "error", msg: "exit 1" }))
    ).toMatchObject({
      status: "error",
      need: "failed",
      detail: "exit 1",
    });
  });
});
