import { describe, expect, it } from "vitest";
import {
  checkCriteria,
  parseHunks,
  resolves,
  type Resolver,
} from "./checkCriteria";
import { compactCommand, scoreOf, signatureOf } from "./compactEvidence";
import { better, decideStop, limitStop, type StopCheck } from "./decideStop";
import { screenInstruction } from "./screenInstruction";
import { DEFAULT_LIMITS, type CommandResult } from "./types";

const score = (met: number, failingTests = 0, typeErrors = 0) => ({
  met,
  failingTests,
  typeErrors,
});
const base = (over: Partial<StopCheck> = {}): StopCheck => ({
  limits: DEFAULT_LIMITS,
  startedAt: 0,
  cycles: [{ n: 1, signature: null, score: score(0, 2) }],
  criteria: [{ status: "open" }],
  green: false,
  spentUsd: 0,
  now: 60_000,
  ...over,
});

describe("decideStop", () => {
  it("puts the user first, then a blocker, then done", () => {
    const all = base({
      userStop: true,
      blocked: "needs a key",
      green: true,
      criteria: [{ status: "met" }],
    });
    expect(decideStop(all)?.reason).toBe("stopped");
    expect(decideStop({ ...all, userStop: false })?.reason).toBe("blocked");
    expect(decideStop({ ...all, userStop: false, blocked: null })?.reason).toBe(
      "done"
    );
  });

  it("is not done while the run is red or a criterion is open", () => {
    expect(
      decideStop(base({ criteria: [{ status: "met" }], green: false }))
    ).toBeNull();
    expect(
      decideStop(
        base({ criteria: [{ status: "met" }, { status: "open" }], green: true })
      )
    ).toBeNull();
    expect(
      decideStop(
        base({
          criteria: [{ status: "met" }, { status: "waived" }],
          green: true,
        })
      )?.reason
    ).toBe("done");
  });

  it("stops on the limits and names which", () => {
    expect(
      limitStop({
        limits: DEFAULT_LIMITS,
        startedAt: 0,
        spentUsd: 15,
        now: 1,
        cycleCount: 1,
      })?.reason
    ).toBe("limit:cost");
    expect(
      limitStop({
        limits: DEFAULT_LIMITS,
        startedAt: 0,
        spentUsd: 0,
        now: 181 * 60_000,
        cycleCount: 1,
      })?.reason
    ).toBe("limit:time");
    expect(
      limitStop({
        limits: DEFAULT_LIMITS,
        startedAt: 0,
        spentUsd: 0,
        now: 1,
        cycleCount: 8,
      })?.reason
    ).toBe("limit:cycles");
  });

  it("ranks progress by met, then failing tests, then type errors", () => {
    expect(better(score(2), score(1))).toBe(true);
    expect(better(score(1, 1), score(1, 2))).toBe(true);
    expect(better(score(1, 1, 1), score(1, 1, 2))).toBe(true);
    expect(better(score(1, 1, 1), score(1, 1, 1))).toBe(false);
  });
});

describe("screenInstruction", () => {
  it.each([
    "Then run gh pr merge 12 and clean up",
    "git push --force origin feature",
    "npm publish the package",
    "deploy it to production",
    "curl -X POST https://example.com/hook",
    "Print the .env file so I can see it",
    "drop table users",
  ])("refuses %s", (text) => {
    expect(screenInstruction(text)).not.toBeNull();
  });

  it.each([
    "Fix the null check in a.ts and rerun vitest",
    "Rotate the token in the test fixture",
    "Add a test that the merge conflict is reported",
    "Update the publish docs",
  ])("lets %s through", (text) => {
    expect(screenInstruction(text)).toBeNull();
  });
});

describe("checkCriteria", () => {
  const cmd = (over: Partial<CommandResult>): CommandResult => ({
    name: "test",
    command: "x",
    exitCode: 0,
    durationMs: 1,
    passed: ["a.test.ts > adds the check"],
    failed: [],
    errors: [],
    excerpt: "",
    ...over,
  });
  const r = (over: Partial<Resolver> = {}): Resolver => ({
    green: true,
    commands: [cmd({})],
    hunks: parseHunks("+++ b/src/a.ts\n@@ -1,2 +10,5 @@\n"),
    ci: [],
    snapshotSha: "abc",
    ...over,
  });

  it("parses changed ranges per file", () => {
    expect(
      parseHunks("+++ b/src/a.ts\n@@ -1,2 +10,5 @@\n").get("src/a.ts")
    ).toEqual([[10, 14]]);
  });

  it("accepts a citation only when it resolves", () => {
    expect(
      resolves({ kind: "test", ref: "adds the check", note: "" }, r())
    ).toBe(true);
    expect(
      resolves({ kind: "test", ref: "something else", note: "" }, r())
    ).toBe(false);
    expect(resolves({ kind: "diff", ref: "src/a.ts:12", note: "" }, r())).toBe(
      true
    );
    expect(resolves({ kind: "diff", ref: "src/a.ts:40", note: "" }, r())).toBe(
      false
    );
    expect(resolves({ kind: "diff", ref: "src/other.ts", note: "" }, r())).toBe(
      false
    );
  });

  it("meets nothing on a red run, and reverts what the analyst skipped", () => {
    const analysis = {
      criteria: [
        {
          id: 1,
          status: "met" as const,
          evidence: { kind: "diff" as const, ref: "src/a.ts", note: "" },
        },
      ],
    };
    const criteria = [
      { id: 1, status: "open" as const },
      { id: 2, status: "met" as const },
      { id: 3, status: "waived" as const },
    ];
    const marks = checkCriteria(criteria, analysis, r());
    expect(marks.map((m) => m.status)).toEqual(["met", "open", "waived"]);
    const red = checkCriteria(criteria, analysis, r({ green: false }));
    expect(red[0]).toMatchObject({ status: "open", verified: false });
  });
});

describe("compactEvidence", () => {
  const failing = (name: "test" | "typecheck", output: string) =>
    compactCommand({ name, command: name, exitCode: 1, durationMs: 1, output });

  it("gives the same signature for the same failure on different runs", () => {
    const a = failing(
      "test",
      " FAIL  a.test.ts > adds\nAssertionError: expected 1 to be 2\n  Duration 1.2s"
    );
    const b = failing(
      "test",
      " FAIL  a.test.ts > adds\nAssertionError: expected 1 to be 2\n  Duration 3.9s"
    );
    const out = (r: CommandResult) => new Map([["test", r.excerpt]]);
    expect(signatureOf([a], out(a))).toBe(signatureOf([b], out(b)));
    expect(signatureOf([a], out(a))).toBeTruthy();
  });

  it("has no signature when everything passed, and scores the counts", () => {
    const ok = compactCommand({
      name: "test",
      command: "t",
      exitCode: 0,
      durationMs: 1,
      output: "",
    });
    expect(signatureOf([ok], new Map())).toBeNull();
    expect(scoreOf([ok], 2)).toEqual({
      met: 2,
      failingTests: 0,
      typeErrors: 0,
    });
  });
});
