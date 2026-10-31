import { describe, expect, it } from "vitest";
import type { UpdateAttempt } from "./banner";
import {
  RETRY_AFTER_MS,
  attemptOf,
  blockFor,
  failedInARow,
  readAttempts,
  recordAttempt,
} from "./history";

const NOW = 10 ** 12;
let n = 0;
const a = (
  to: string,
  outcome: UpdateAttempt["outcome"],
  finishedAt = NOW,
  auto = true
): UpdateAttempt => ({
  id: `a${n++}`,
  from: "f",
  to,
  fromVersion: "",
  toVersion: "",
  auto,
  startedAt: finishedAt - 1,
  finishedAt,
  outcome,
});

const store = () => {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k) ?? null,
    put: (k: string, v: string | null) =>
      void (v === null ? m.delete(k) : m.set(k, v)),
  };
};

describe("history", () => {
  it("records each run once, newest first, and keeps the last 20", () => {
    const s = store();
    const first = a("x", "done");
    expect(recordAttempt(s.get, s.put, first)).toBe(true);
    expect(recordAttempt(s.get, s.put, first)).toBe(false);
    for (let i = 0; i < 25; i++)
      recordAttempt(s.get, s.put, a(`s${i}`, "done"));
    const list = readAttempts(s.get);
    expect(list).toHaveLength(20);
    expect(list[0].to).toBe("s24");
  });

  it("reads garbage as no history", () => {
    expect(readAttempts(() => "{nope")).toEqual([]);
  });

  it("only a finished run with an outcome and a target is an attempt", () => {
    const run = {
      id: "r",
      phase: "done" as const,
      from: "f",
      fromVersion: "1",
      toVersion: "2",
      startedAt: 1,
    };
    expect(attemptOf(run)).toBeNull();
    expect(
      attemptOf({ ...run, to: "t", outcome: "done", finishedAt: 2 })
    ).toMatchObject({ to: "t", outcome: "done", auto: false });
  });

  it("a rolled-back or broken commit is never tried again", () => {
    expect(blockFor("x", [a("x", "rolled_back", 0)], NOW)?.kind).toBe("bad");
    expect(blockFor("x", [a("x", "broken", 0)], NOW)?.kind).toBe("bad");
    expect(blockFor("y", [a("x", "broken", 0)], NOW)).toBeNull();
  });

  it("a build failure waits an hour, then six, then gives up", () => {
    const one = [a("x", "build_failed", NOW)];
    expect(blockFor("x", one, NOW)).toMatchObject({
      kind: "later",
      until: NOW + RETRY_AFTER_MS[0],
    });
    expect(blockFor("x", one, NOW + RETRY_AFTER_MS[0])).toBeNull();
    const two = [a("x", "build_failed", NOW), a("x", "build_failed", NOW - 5)];
    expect(blockFor("x", two, NOW)).toMatchObject({
      until: NOW + RETRY_AFTER_MS[1],
    });
    const three = [...two, a("x", "build_failed", NOW - 9)];
    expect(blockFor("x", three, NOW + 10 ** 9)?.kind).toBe("bad");
  });

  it("failures before the last success don't count, nor do interruptions", () => {
    const list = [
      a("x", "interrupted"),
      a("x", "done", NOW - 10),
      a("x", "build_failed", NOW - 20),
      a("x", "build_failed", NOW - 30),
      a("x", "build_failed", NOW - 40),
    ];
    expect(blockFor("x", list, NOW)).toBeNull();
  });

  it("counts automatic failures in a row", () => {
    expect(
      failedInARow([
        a("x", "build_failed"),
        a("y", "interrupted"),
        a("y", "rolled_back"),
        a("z", "done", NOW, false),
        a("w", "build_failed"),
      ])
    ).toBe(2);
  });
});
