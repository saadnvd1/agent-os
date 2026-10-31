import { describe, expect, it } from "vitest";
import { decideAutoUpdate, LULL_MS, type AutoInput } from "./auto";
import type { UpdateAttempt } from "./banner";

const MIN = 60_000;
const H = 60 * MIN;
const NOW = 1_000 * H;

const input = (over: Partial<AutoInput> = {}): AutoInput => ({
  enabled: true,
  locked: false,
  managed: false,
  refusal: null,
  candidates: [{ sha: "a".repeat(40), at: NOW - 3 * H }],
  attempts: [],
  busy: [],
  quietSince: NOW - 11 * MIN,
  now: NOW,
  soakMs: 2 * H,
  idleMs: 10 * MIN,
  deadlineMs: 72 * H,
  ...over,
});

const attempt = (
  to: string,
  outcome: UpdateAttempt["outcome"],
  finishedAt = NOW - MIN
): UpdateAttempt => ({
  id: `${to}-${outcome}-${finishedAt}`,
  from: "f",
  to,
  fromVersion: "",
  toVersion: "",
  auto: true,
  startedAt: finishedAt - MIN,
  finishedAt,
  outcome,
});

const decide = (over: Partial<AutoInput> = {}) => decideAutoUpdate(input(over));

describe("decideAutoUpdate", () => {
  it.each([
    [{ locked: true }, "locked"],
    [{ enabled: false }, "off"],
    [{ managed: true }, "managed"],
    [{ refusal: "This checkout has local changes" }, "refused"],
    [{ candidates: [] }, "up_to_date"],
  ] as [Partial<AutoInput>, string][])("skips when %o", (over, code) => {
    expect(decide(over)).toMatchObject({ action: "skip", code });
  });

  it("a pin beats the switch and the switch beats everything else", () => {
    expect(decide({ locked: true, enabled: true }).action).toBe("skip");
    expect(decide({ enabled: false, refusal: "x" })).toMatchObject({
      code: "off",
    });
  });

  it("starts with a soaked release after the idle time", () => {
    expect(decide()).toEqual({ action: "start", to: "a".repeat(40) });
  });

  it("waits for a release to soak", () => {
    const d = decide({ candidates: [{ sha: "b", at: NOW - 30 * MIN }] });
    expect(d).toMatchObject({ action: "wait", code: "soaking" });
  });

  it("takes the newest soaked commit when the head is too new", () => {
    expect(
      decide({
        candidates: [
          { sha: "head", at: NOW - 5 * MIN },
          { sha: "mid", at: NOW - 2 * H - 1 },
          { sha: "old", at: NOW - 9 * H },
        ],
      })
    ).toEqual({ action: "start", to: "mid" });
  });

  it("waits while anything is working, naming it", () => {
    const d = decide({ busy: ["1 review", "1 merge"] });
    expect(d).toMatchObject({ action: "wait", code: "busy" });
    expect("text" in d && d.text).toContain("1 review, 1 merge");
  });

  it("waits until the idle time has passed, counted from when quiet began", () => {
    expect(decide({ quietSince: NOW - 9 * MIN })).toMatchObject({
      action: "wait",
      code: "quiet",
    });
    expect(decide({ quietSince: null })).toMatchObject({ code: "quiet" });
    expect(decide({ quietSince: NOW - 10 * MIN }).action).toBe("start");
  });

  it("past the deadline a short lull is enough, but work still blocks it", () => {
    const late = {
      candidates: [{ sha: "a", at: NOW - 2 * H - 72 * H }],
      quietSince: NOW - LULL_MS,
    };
    expect(decide(late).action).toBe("start");
    expect(decide({ ...late, quietSince: NOW - LULL_MS + 1 }).action).toBe(
      "wait"
    );
    expect(decide({ ...late, busy: ["1 session working"] })).toMatchObject({
      action: "wait",
      code: "busy",
    });
    // Before the deadline the same lull isn't enough.
    expect(decide({ quietSince: NOW - LULL_MS }).action).toBe("wait");
  });

  it("passes over a rolled-back commit for an older good one, else waits", () => {
    const candidates = [
      { sha: "bad", at: NOW - 3 * H },
      { sha: "good", at: NOW - 4 * H },
    ];
    expect(
      decide({ candidates, attempts: [attempt("bad", "rolled_back")] })
    ).toEqual({ action: "start", to: "good" });
    expect(
      decide({
        candidates: [candidates[0]],
        attempts: [attempt("bad", "broken")],
      })
    ).toMatchObject({ action: "wait", code: "blocked" });
  });

  it("backs off a commit that failed to build, then tries it again", () => {
    const c = { candidates: [{ sha: "x", at: NOW - 9 * H }] };
    const failed = [attempt("x", "build_failed", NOW - 30 * MIN)];
    expect(decide({ ...c, attempts: failed })).toMatchObject({
      code: "blocked",
    });
    expect(decide({ ...c, attempts: failed, now: NOW + 31 * MIN }).action).toBe(
      "start"
    );
  });

  it("an interrupted run says nothing about the commit", () => {
    expect(
      decide({ attempts: [attempt("a".repeat(40), "interrupted")] })
    ).toEqual({ action: "start", to: "a".repeat(40) });
  });
});
