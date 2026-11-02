import { describe, expect, it } from "vitest";
import { NOW, facts, pr, withTask } from "../orchestrator/fixtures";
import type { SessionFacts } from "../orchestrator/facts";
import {
  IDLE_DIRTY_MS,
  STALE_REVIEW_MS,
  STALL_MS,
  needsGitCheck,
  pickCandidates,
  seenKey,
  type ReviewSeen,
  type SweepView,
} from "./sweep";

const WINDOW = 60 * 60 * 1000;

// Each session's real turn is its lastActive unless a test says otherwise;
// every interactive session's agent is up.
const view = (
  list: SessionFacts[],
  over: Partial<SweepView> = {}
): SweepView => ({
  now: NOW,
  facts: list,
  turns: new Map(list.map((f) => [f.id, f.lastActive])),
  windowMs: WINDOW,
  live: new Set(list.filter((f) => !f.task).map((f) => f.id)),
  dirty: new Set(),
  reviewOf: () => null,
  held: new Set(),
  acted: new Set(),
  ...over,
});

const gitView = (list: SessionFacts[], over: Partial<SweepView> = {}) =>
  view(list, over);

const quiet = (ms: number) => NOW - ms;

// A task with no PR, idle for a while.
const idleTask = (
  id: string,
  idleMs: number,
  over: Partial<SessionFacts> = {}
) =>
  facts(id, {
    status: "idle",
    lastActive: quiet(idleMs),
    task: { state: "review", pr: null, blocked: null },
    ...over,
  });

const kinds = (v: SweepView) =>
  pickCandidates(v).flags.map((c) => `${c.kind}:${c.sessionId}`);

describe("the away sweep's stalled tasks", () => {
  it("lists a task quiet past the stall time with no PR, and not one that's younger", () => {
    const v = view([
      idleTask("old", STALL_MS + 60_000),
      idleTask("young", STALL_MS - 60_000),
    ]);
    const { flags } = pickCandidates(v);
    expect(flags.map((c) => `${c.kind}:${c.sessionId}`)).toEqual([
      "stalled:old",
    ]);
    expect(flags[0].line).toContain("no activity for 31m, no PR yet");
  });

  it("lists a quiet task whose CI is failing, and says so", () => {
    const f = idleTask("ci", STALL_MS, {
      task: {
        state: "checks-failing",
        pr: pr({ number: 7, checks: "fail" }),
        blocked: null,
      },
    });
    const [c] = pickCandidates(view([f])).flags;
    expect(c.kind).toBe("stalled");
    expect(c.line).toContain("CI failing on PR #7");
  });

  it("leaves a task whose PR waits on CI or review alone, however quiet", () => {
    const f = idleTask("waiting", STALL_MS * 3, {
      task: { state: "review", pr: pr({ checks: "pending" }), blocked: null },
    });
    expect(kinds(view([f]))).toEqual([]);
  });

  it("skips what someone already waits on: blocked, needs input, held for the owner, dead, setting up", () => {
    const long = STALL_MS * 2;
    const list = [
      idleTask("blocked", long, {
        task: { state: "blocked", pr: null, blocked: "need a key" },
      }),
      idleTask("asking", long, { status: "waiting", needsInput: true }),
      idleTask("held", long),
      idleTask("dead", long, { status: "dead" }),
      idleTask("setup", long, { status: "running", activity: "setting up" }),
      idleTask("exited", long, {
        task: { state: "exited", pr: null, blocked: null },
      }),
      idleTask("merged", long, {
        task: { state: "merged", pr: null, blocked: null },
      }),
    ];
    expect(kinds(view(list, { held: new Set(["held"]) }))).toEqual([]);
  });

  it("lists a task once per quiet spell", () => {
    const f = idleTask("t", STALL_MS);
    const { flags } = pickCandidates(view([f]));
    // The same spell again: already listed.
    expect(kinds(view([f], { acted: new Set([flags[0].key]) }))).toEqual([]);
    // It moved and went quiet again: a new spell, listed again.
    const later = idleTask("t", STALL_MS + 1);
    expect(kinds(view([later], { acted: new Set([flags[0].key]) }))).toEqual([
      "stalled:t",
    ]);
  });
});

describe("the away window", () => {
  it("never lists a session whose last real turn is older than the window", () => {
    const old = idleTask("old", WINDOW + 60_000);
    const mine = facts("mine", {
      task: null,
      status: "idle",
      lastActive: quiet(WINDOW + 60_000),
    });
    const v = view([old, mine], { dirty: new Set(["old", "mine"]) });
    expect(kinds(v)).toEqual([]);
    expect(needsGitCheck(v)).toEqual([]);
  });

  it("goes by the real turn, not a status poll's bump of lastActive", () => {
    // Polled a minute ago, last worked two hours ago.
    const f = idleTask("polled", 60_000);
    const v = view([f], {
      turns: new Map([["polled", quiet(2 * WINDOW)]]),
      dirty: new Set(["polled"]),
    });
    expect(kinds(v)).toEqual([]);
  });

  it("follows the configured window", () => {
    const f = idleTask("t", 90 * 60_000);
    expect(kinds(view([f]))).toEqual([]);
    expect(kinds(view([f], { windowMs: 2 * WINDOW }))).toEqual(["stalled:t"]);
  });

  it("treats a session with no turn at all as left alone", () => {
    const f = idleTask("never", STALL_MS);
    expect(kinds(view([f], { turns: new Map() }))).toEqual([]);
  });
});

describe("the away sweep's uncommitted work", () => {
  it("lists an idle task with uncommitted work and no PR", () => {
    const f = idleTask("dirty", IDLE_DIRTY_MS);
    const { flags } = pickCandidates(view([f], { dirty: new Set(["dirty"]) }));
    expect(flags.map((c) => c.kind)).toEqual(["commit"]);
    expect(flags[0].line).toMatch(/uncommitted work and no PR/);
  });

  it("lists it only once for the same idle spell", () => {
    const f = idleTask("dirty", IDLE_DIRTY_MS);
    const v = view([f], { dirty: new Set(["dirty"]) });
    const [c] = pickCandidates(v).flags;
    expect(
      kinds({ ...v, acted: new Set([c.key]) }).filter((k) =>
        k.startsWith("commit")
      )
    ).toEqual([]);
  });

  it("reads git only for sessions quiet long enough, idle, with no PR", () => {
    const list = [
      idleTask("yes", IDLE_DIRTY_MS),
      idleTask("recent", IDLE_DIRTY_MS - 1000),
      idleTask("working", IDLE_DIRTY_MS, { status: "running" }),
      idleTask("pr", IDLE_DIRTY_MS, {
        task: { state: "review", pr: pr(), blocked: null },
      }),
      facts("mine", {
        task: null,
        status: "idle",
        lastActive: quiet(IDLE_DIRTY_MS),
      }),
    ];
    expect(needsGitCheck(gitView(list))).toEqual(["yes", "mine"]);
    expect(
      needsGitCheck(gitView(list, { acted: new Set(["wrapup:mine"]) }))
    ).toEqual(["yes"]);
    // An interactive session whose agent isn't up is never read.
    expect(needsGitCheck(gitView(list, { live: new Set() }))).toEqual(["yes"]);
  });
});

describe("the away sweep and the owner's own sessions", () => {
  const mine = (over: Partial<SessionFacts> = {}) =>
    facts("mine", {
      task: null,
      status: "idle",
      lastActive: quiet(STALL_MS + 60_000),
      ...over,
    });

  it("lists a recent interactive session with uncommitted work once a period, and nothing else", () => {
    const v = view([mine()], { dirty: new Set(["mine"]) });
    const { flags } = pickCandidates(v);
    expect(flags.map((c) => c.kind)).toEqual(["wrapup"]);
    expect(flags[0].line).toMatch(/the owner's own session/);
    expect(kinds({ ...v, acted: new Set([flags[0].key]) })).toEqual([]);
  });

  it("skips an interactive session that's stopped or whose agent isn't up", () => {
    const dirty = new Set(["mine"]);
    expect(
      kinds(view([mine({ status: "dead" })], { dirty, live: new Set() }))
    ).toEqual([]);
    expect(kinds(view([mine()], { dirty, live: new Set() }))).toEqual([]);
  });

  it("leaves a clean or busy interactive session alone", () => {
    expect(kinds(view([mine()]))).toEqual([]);
    expect(
      kinds(view([mine({ status: "running" })], { dirty: new Set(["mine"]) }))
    ).toEqual([]);
  });
});

const reviewKinds = (v: SweepView) =>
  pickCandidates(v).reviews.map((c) => `${c.kind}:${c.sessionId}`);

describe("the away sweep's lost reviews", () => {
  const green = (
    id: string,
    over: Partial<NonNullable<SessionFacts["task"]>> = {}
  ) =>
    withTask(id, { pr: pr({ checks: "pass", head: "abc1234def" }), ...over });

  const seen = (id: string) => new Set([seenKey(id, "abc1234def")]);

  it("runs a review never started on the head, once seen on two sweeps", () => {
    const first = pickCandidates(view([green("t")]));
    expect(first.reviews).toEqual([]);
    expect(first.firstSeen).toEqual([seenKey("t", "abc1234def")]);
    const second = pickCandidates(view([green("t")], { acted: seen("t") }));
    expect(second.reviews.map((c) => c.kind)).toEqual(["review"]);
    expect(second.reviews[0].line).toContain("never started");
  });

  it("runs again an errored review, and one cut off long enough ago", () => {
    const at = (status: ReviewSeen["status"], ageMs: number) => () => ({
      status,
      at: NOW - ageMs,
    });
    expect(
      reviewKinds(
        view([green("t")], { acted: seen("t"), reviewOf: at("error", 0) })
      )
    ).toEqual(["review:t"]);
    expect(
      reviewKinds(
        view([green("t")], {
          acted: seen("t"),
          reviewOf: at("running", STALE_REVIEW_MS),
        })
      )
    ).toEqual(["review:t"]);
    expect(
      reviewKinds(
        view([green("t")], {
          acted: seen("t"),
          reviewOf: at("running", STALE_REVIEW_MS - 1000),
        })
      )
    ).toEqual([]);
    expect(
      reviewKinds(
        view([green("t")], { acted: seen("t"), reviewOf: at("pass", 0) })
      )
    ).toEqual([]);
  });

  it("doesn't review before CI is green and settled, on a held task, or twice", () => {
    const pending = withTask("p", {
      pr: pr({ checks: "pending", head: "abc1234def" }),
    });
    const settling = green("s", { ciSettleIn: 30 });
    const acted = new Set([
      ...seen("p"),
      ...seen("s"),
      ...seen("h"),
      ...seen("t"),
      "review:t:abc1234def",
    ]);
    expect(
      reviewKinds(
        view([pending, settling, green("h"), green("t")], {
          acted,
          held: new Set(["h"]),
        })
      )
    ).toEqual([]);
  });
});
