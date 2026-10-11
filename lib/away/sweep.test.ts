import { describe, expect, it } from "vitest";
import { NOW, facts, pr, withTask } from "../orchestrator/fixtures";
import type { SessionFacts } from "../orchestrator/facts";
import {
  IDLE_DIRTY_MS,
  MAX_NUDGES,
  STALE_REVIEW_MS,
  STALL_MS,
  needsGitCheck,
  pickCandidates,
  seenKey,
  type ReviewSeen,
  type SweepView,
} from "./sweep";

const view = (
  list: SessionFacts[],
  over: Partial<SweepView> = {}
): SweepView => ({
  now: NOW,
  facts: list,
  dirty: new Set(),
  reviewOf: () => null,
  held: new Set(),
  acted: new Set(),
  nudges: new Map(),
  ...over,
});

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
  pickCandidates(v).act.map((c) => `${c.kind}:${c.sessionId}`);

describe("the away sweep's stalled tasks", () => {
  it("nudges a task quiet past the stall time with no PR, and not one that's younger", () => {
    const v = view([
      idleTask("old", STALL_MS + 60_000),
      idleTask("young", STALL_MS - 60_000),
    ]);
    const { act } = pickCandidates(v);
    expect(act.map((c) => `${c.kind}:${c.sessionId}`)).toEqual(["nudge:old"]);
    expect(act[0].message).toContain("31 minutes");
    expect(act[0].message).toContain("BLOCKED:");
  });

  it("nudges a quiet task whose CI is failing, and says so", () => {
    const f = idleTask("ci", STALL_MS, {
      task: {
        state: "checks-failing",
        pr: pr({ number: 7, checks: "fail" }),
        blocked: null,
      },
    });
    const [c] = pickCandidates(view([f])).act;
    expect(c.kind).toBe("nudge");
    expect(c.message).toContain("CI is failing on PR #7");
  });

  it("leaves a task whose PR waits on CI or review alone, however quiet", () => {
    const f = idleTask("waiting", STALL_MS * 3, {
      task: { state: "review", pr: pr({ checks: "pending" }), blocked: null },
    });
    expect(kinds(view([f]))).toEqual([]);
  });

  it("skips what someone already waits on: blocked, needs input, held for Saad, dead, setting up", () => {
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

  it("nudges once per quiet spell, and at most MAX_NUDGES times a period", () => {
    const f = idleTask("t", STALL_MS);
    const { act } = pickCandidates(view([f]));
    // The same spell again: already acted on.
    expect(kinds(view([f], { acted: new Set([act[0].key]) }))).toEqual([]);
    // It moved and went quiet again: a new spell, nudged again.
    const later = idleTask("t", STALL_MS + 1);
    expect(kinds(view([later], { acted: new Set([act[0].key]) }))).toEqual([
      "nudge:t",
    ]);
    expect(
      kinds(view([later], { nudges: new Map([["t", MAX_NUDGES]]) }))
    ).toEqual([]);
  });
});

describe("the away sweep's uncommitted work", () => {
  it("asks an idle task with uncommitted work and no PR to commit and open one", () => {
    const f = idleTask("dirty", IDLE_DIRTY_MS);
    const { act } = pickCandidates(view([f], { dirty: new Set(["dirty"]) }));
    expect(act.map((c) => c.kind)).toEqual(["commit"]);
    expect(act[0].message).toMatch(/Commit it and open a pull request/);
    expect(act[0].message).toMatch(/why not/);
  });

  it("asks only once for the same idle spell", () => {
    const f = idleTask("dirty", IDLE_DIRTY_MS);
    const v = view([f], { dirty: new Set(["dirty"]) });
    const [c] = pickCandidates(v).act;
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
    expect(needsGitCheck(list, NOW, new Set())).toEqual(["yes", "mine"]);
    expect(needsGitCheck(list, NOW, new Set(["wrapup:mine"]))).toEqual(["yes"]);
  });
});

describe("the away sweep and Saad's own sessions", () => {
  const mine = (over: Partial<SessionFacts> = {}) =>
    facts("mine", {
      task: null,
      status: "idle",
      lastActive: quiet(STALL_MS * 4),
      ...over,
    });

  it("only asks an interactive session to wrap up, once a period, and never nudges it", () => {
    const v = view([mine()], { dirty: new Set(["mine"]) });
    const { act } = pickCandidates(v);
    expect(act.map((c) => c.kind)).toEqual(["wrapup"]);
    expect(act[0].message).toMatch(/Wrap up/);
    expect(act[0].message).toMatch(/don't start anything new/);
    expect(kinds({ ...v, acted: new Set([act[0].key]) })).toEqual([]);
  });

  it("leaves a clean or busy interactive session alone", () => {
    expect(kinds(view([mine()]))).toEqual([]);
    expect(
      kinds(view([mine({ status: "running" })], { dirty: new Set(["mine"]) }))
    ).toEqual([]);
  });
});

describe("the away sweep's lost reviews", () => {
  const green = (
    id: string,
    over: Partial<NonNullable<SessionFacts["task"]>> = {}
  ) =>
    withTask(id, { pr: pr({ checks: "pass", head: "abc1234def" }), ...over });

  const seen = (id: string) => new Set([seenKey(id, "abc1234def")]);

  it("runs a review never started on the head, once seen on two sweeps", () => {
    const first = pickCandidates(view([green("t")]));
    expect(first.act).toEqual([]);
    expect(first.firstSeen).toEqual([seenKey("t", "abc1234def")]);
    const second = pickCandidates(view([green("t")], { acted: seen("t") }));
    expect(second.act.map((c) => c.kind)).toEqual(["review"]);
    expect(second.act[0].log).toContain("never started");
  });

  it("runs again an errored review, and one cut off long enough ago", () => {
    const at = (status: ReviewSeen["status"], ageMs: number) => () => ({
      status,
      at: NOW - ageMs,
    });
    expect(
      kinds(view([green("t")], { acted: seen("t"), reviewOf: at("error", 0) }))
    ).toEqual(["review:t"]);
    expect(
      kinds(
        view([green("t")], {
          acted: seen("t"),
          reviewOf: at("running", STALE_REVIEW_MS),
        })
      )
    ).toEqual(["review:t"]);
    expect(
      kinds(
        view([green("t")], {
          acted: seen("t"),
          reviewOf: at("running", STALE_REVIEW_MS - 1000),
        })
      )
    ).toEqual([]);
    expect(
      kinds(view([green("t")], { acted: seen("t"), reviewOf: at("pass", 0) }))
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
      kinds(
        view([pending, settling, green("h"), green("t")], {
          acted,
          held: new Set(["h"]),
        })
      )
    ).toEqual([]);
  });
});
