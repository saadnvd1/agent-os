import { describe, expect, it } from "vitest";
import { failureOf, recordFailure, recordPass } from "./gates";
import {
  ciSignature,
  LOOP_GUARD_COMMITS,
  reasonSignature,
  reviewSignature,
  stuckBy,
} from "./loop-guard";

// `gh run view --log-failed`: job, step, timestamped text.
const log = (...lines: string[]) =>
  lines
    .map((l, i) => `Test 2\tRun tests\t2026-10-15T12:00:0${i}.123Z ${l}`)
    .join("\n");

describe("a CI failure's signature", () => {
  it("names the job and its failing tests, whatever order and timing they ran in", () => {
    const one = log(
      " RUN  v4.1.11",
      " FAIL  lib/a.test.ts > adds > carries 12ms",
      " FAIL  lib/b.test.ts > subtracts [ 1.2s ]",
      "Error: Process completed with exit code 1."
    );
    const two = log(
      " FAIL  lib/b.test.ts > subtracts [ 3.4s ]",
      "\x1b[31m FAIL  lib/a.test.ts > adds > carries 40ms\x1b[0m"
    );
    expect(ciSignature("Test 2", one)).toBe(
      "Test 2: lib/a.test.ts > adds > carries; lib/b.test.ts > subtracts"
    );
    expect(ciSignature("Test 2", two)).toBe(ciSignature("Test 2", one));
    expect(ciSignature("Test 3", two)).not.toBe(ciSignature("Test 2", one));
    expect(
      ciSignature("Test 2", log(" FAIL  lib/a.test.ts > adds > borrows"))
    ).not.toBe(ciSignature("Test 2", one));
  });

  it("falls back to the first error line, without the commit it names", () => {
    const at = (sha: string) =>
      log(
        "npm run typecheck",
        `##[error]lib/a.ts(3,5): error TS2322 at ${sha}`,
        "Error: Process completed with exit code 2."
      );
    expect(ciSignature("Static", at("abc1234"))).toBe(
      "Static: ##[error]lib/a.ts(3,5): error TS2322 at <sha>"
    );
    expect(ciSignature("Static", at("def5678"))).toBe(
      ciSignature("Static", at("abc1234"))
    );
  });

  it("is nothing without a job or a log, rather than a guess", () => {
    expect(ciSignature(null, log(" FAIL  a.test.ts > x"))).toBeNull();
    expect(ciSignature("Build", null)).toBeNull();
    expect(ciSignature("Build", log("compiling", "done"))).toBeNull();
  });
});

describe("a review's signature", () => {
  it("is its blocking findings by place, not by wording", () => {
    const a = reviewSignature(
      "Two bugs.\n- [blocking] src/a.ts:3: off by one\n- [minor] src/c.ts:1: naming\n- [blocking] src/b.ts:9: no null check"
    );
    const b = reviewSignature(
      "Still wrong.\n- [blocking] src/b.ts:9: null not handled\n- [blocking] src/a.ts:3: loop ends one early"
    );
    expect(a).toBe("src/a.ts:3, src/b.ts:9");
    expect(b).toBe(a);
    expect(reviewSignature("- [blocking] src/a.ts:4: off by one")).not.toBe(
      reviewSignature("- [blocking] src/a.ts:3: off by one")
    );
  });

  it("knows a finding with no place by how it starts", () => {
    expect(
      reviewSignature("- [blocking]: Tests were deleted to make CI pass.")
    ).toBe("tests were deleted to make ci pass.");
    expect(reviewSignature("Looks right.\n- [minor] a.ts:1: x")).toBeNull();
  });

  it("reads any other gate's reason without its commit", () => {
    expect(reasonSignature("BLOCKED on abc1234: needs a key")).toBe(
      reasonSignature("BLOCKED on 9f8e7d6: needs a key")
    );
    expect(reasonSignature("")).toBeNull();
  });
});

describe("the streak a gate's failures make", () => {
  const sha = (n: number) => String(n).repeat(40);

  it("counts commits in a row, and a pass starts again", () => {
    const task = "guard-streak";
    for (let n = 1; n < LOOP_GUARD_COMMITS; n++) {
      recordFailure("w", task, "ci", "why", sha(n), `sig ${n}`);
      expect(stuckBy(failureOf(task, "ci")!)).toBeNull();
    }
    // The same head judged again isn't another commit.
    recordFailure("w", task, "ci", "why", sha(3), "sig 3");
    expect(failureOf(task, "ci")).toMatchObject({ streak: 3, repeated: 0 });
    recordPass(task, "ci");
    recordFailure("w", task, "ci", "why", sha(4), "sig 4");
    expect(failureOf(task, "ci")).toMatchObject({ count: 4, streak: 1 });
    for (let n = 5; n <= 7; n++)
      recordFailure("w", task, "ci", "why", sha(n), `sig ${n}`);
    expect(stuckBy(failureOf(task, "ci")!)).toBe("streak");
  });

  it("flags the same signature on consecutive commits only", () => {
    const task = "guard-repeat";
    const repeated = () => failureOf(task, "review")!.repeated;
    recordFailure("w", task, "review", "why", sha(1), "a.ts:1");
    recordFailure("w", task, "review", "why", sha(2), "a.ts:2");
    expect(stuckBy(failureOf(task, "review")!)).toBeNull();
    // No signature never matches.
    recordFailure("w", task, "review", "why", sha(3), null);
    recordFailure("w", task, "review", "why", sha(4), null);
    expect(repeated()).toBe(0);
    recordFailure("w", task, "review", "why", sha(5), "a.ts:2");
    expect(repeated()).toBe(0);
    // Re-judging a head keeps what its first judgment found.
    recordFailure("w", task, "review", "why", sha(5), "a.ts:9");
    recordFailure("w", task, "review", "why", sha(6), "a.ts:2");
    expect(repeated()).toBe(1);
  });

  it("goes to Saad on a repeat before the streak runs out", () => {
    const task = "guard-repeat-early";
    recordFailure("w", task, "ci", "why", sha(1), "Test 1: a > b");
    recordFailure("w", task, "ci", "why", sha(2), "Test 1: a > b");
    expect(failureOf(task, "ci")?.streak).toBe(2);
    expect(stuckBy(failureOf(task, "ci")!)).toBe("repeat");
  });

  it("doesn't repeat across a pass", () => {
    const task = "guard-pass";
    recordFailure("w", task, "ci", "why", sha(1), "same");
    recordPass(task, "ci");
    recordFailure("w", task, "ci", "why", sha(2), "same");
    expect(failureOf(task, "ci")).toMatchObject({ streak: 1, repeated: 0 });
  });
});
