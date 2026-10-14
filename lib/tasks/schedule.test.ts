import { describe, expect, it } from "vitest";
import {
  AGE_CAP,
  HEAVY_START_GAP_MS,
  LOAD_SETTLE_MS,
  RESUME_BONUS,
  START_GAP_MS,
  planStarts,
  scoreParts,
  type Candidate,
  type Group,
  type MachineView,
  type Priority,
} from "./schedule";

const T0 = Date.UTC(2026, 9, 13, 14, 0, 0);
const min = (n: number) => n * 60_000;

const green = (over: Partial<MachineView> = {}): MachineView => ({
  label: "this machine",
  enabled: true,
  reading: false,
  level: "green",
  settled: true,
  settleLeftMs: 0,
  booted: 0,
  maxBooted: 2,
  heavyStarting: 0,
  lastAutoStartAt: null,
  lastHeavyStartAt: null,
  ...over,
});

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  kind: "start",
  group: "ws",
  priority: "normal",
  position: 1,
  waitingSinceMs: T0,
  heavy: false,
  needsUnmet: false,
  remote: false,
  before: null,
  auto: null,
  any: null,
  ...over,
});

const groups = (inFlight = 0, limit = 4) =>
  new Map<string, Group>([["ws", { inFlight, limit }]]);

const score = (
  priority: Priority,
  waitedMin: number,
  kind: Candidate["kind"] = "start"
) =>
  scoreParts(
    cand("x", { priority, kind, waitingSinceMs: T0 - min(waitedMin) }),
    T0
  ).score;

describe("score", () => {
  it("a fresh urgent task beats every queued normal one and a fresh normal resume", () => {
    const urgent = score("urgent", 0);
    expect(urgent).toBeGreaterThan(score("normal", 100000));
    expect(urgent).toBeGreaterThan(score("normal", 0, "resume"));
    expect(score("normal", 100000, "resume")).toBeGreaterThan(urgent);
  });

  it("a background task overtakes a fresh normal one after 200 minutes, never a fresh blocking one", () => {
    expect(score("background", 199)).toBeLessThan(score("normal", 0));
    expect(score("background", 201)).toBeGreaterThan(score("normal", 0));
    expect(score("background", 1e6)).toBeLessThan(score("blocking", 0));
  });

  it("a normal resume beats a fresh blocking task but not an urgent one", () => {
    expect(score("normal", 0, "resume")).toBeGreaterThan(score("blocking", 0));
    expect(score("normal", 0, "resume")).toBeLessThan(score("urgent", 0));
  });

  it("caps age and adds the resume bonus", () => {
    expect(
      scoreParts(cand("a", { waitingSinceMs: T0 - min(10000) }), T0).age
    ).toBe(AGE_CAP);
    expect(scoreParts(cand("a", { kind: "resume" }), T0).resume).toBe(
      RESUME_BONUS
    );
  });

  it("orders by score then by line position", () => {
    const plan = planStarts(
      [
        cand("late", { position: 2 }),
        cand("early", { position: 1 }),
        cand("urgent", { position: 3, priority: "urgent" }),
      ],
      groups(3, 4),
      green(),
      T0
    );
    expect(plan.start).toEqual(["urgent"]);
    expect(plan.explain.get("late")?.code).toBe("spacing");
    const full = planStarts(
      [cand("late", { position: 2 }), cand("early", { position: 1 })],
      groups(4, 4),
      green(),
      T0
    );
    expect(full.explain.get("late")?.text).toBe("#2 of 2");
    expect(plan.explain.get("early")?.rank).toBe(2);
  });
});

describe("holds", () => {
  it("shows an unmet after first, then the machine", () => {
    const plan = planStarts(
      [cand("a", { before: { code: "after", text: "After Build" } })],
      groups(),
      green({ level: "red", settled: false }),
      T0
    );
    expect(plan.explain.get("a")).toMatchObject({
      code: "after",
      text: "After Build",
    });
  });

  it("holds while red and until calm for LOAD_SETTLE_MS", () => {
    const red = planStarts(
      [cand("a")],
      groups(),
      green({ level: "red", settled: false }),
      T0
    );
    expect(red.explain.get("a")?.text).toBe("Waiting: this machine load red");
    const settling = planStarts(
      [cand("a")],
      groups(),
      green({ settled: false, settleLeftMs: LOAD_SETTLE_MS - 30_000 }),
      T0
    );
    expect(settling.explain.get("a")?.code).toBe("load_red");
    expect(planStarts([cand("a")], groups(), green(), T0).start).toEqual(["a"]);
  });

  it("holds before the first sample", () => {
    const plan = planStarts(
      [cand("a")],
      groups(),
      green({ reading: true }),
      T0
    );
    expect(plan.explain.get("a")?.text).toBe("Waiting: reading machine load");
  });

  it("lets only blocking and urgent start on amber", () => {
    const m = green({ level: "amber" });
    const plan = planStarts(
      [
        cand("n", { position: 1 }),
        cand("b", { position: 2, priority: "blocking" }),
        cand("u", { position: 3, priority: "urgent" }),
      ],
      groups(),
      m,
      T0
    );
    expect(plan.explain.get("n")?.code).toBe("load_amber");
    expect(plan.start).toEqual(["u"]);
    expect(plan.explain.get("b")?.code).toBe("spacing");
  });

  it("does not hold on load when load checks are off, or for a remote task", () => {
    expect(
      planStarts(
        [cand("a")],
        groups(),
        green({ enabled: false, level: "red", settled: false }),
        T0
      ).start
    ).toEqual(["a"]);
    expect(
      planStarts(
        [cand("a", { remote: true })],
        groups(),
        green({ level: "red", settled: false }),
        T0
      ).start
    ).toEqual(["a"]);
  });

  it("spaces automatic starts", () => {
    const plan = planStarts(
      [cand("a", { position: 1 }), cand("b", { position: 2 })],
      groups(),
      green(),
      T0
    );
    expect(plan.start).toEqual(["a"]);
    expect(plan.explain.get("b")?.text).toBe(
      `Waiting: spacing starts (next in ${START_GAP_MS / 1000}s)`
    );
    const later = planStarts(
      [cand("b")],
      groups(),
      green({ lastAutoStartAt: T0 - START_GAP_MS + 40_000 }),
      T0
    );
    expect(later.explain.get("b")?.text).toBe(
      "Waiting: spacing starts (next in 40s)"
    );
  });

  it("limits heavy tasks by simulators booted, one booting at a time, and a gap", () => {
    const heavy = (id: string, position = 1) =>
      cand(id, { heavy: true, position });
    expect(
      planStarts([heavy("a")], groups(), green({ booted: 2 }), T0).explain.get(
        "a"
      )?.text
    ).toBe("Waiting: 2 of 2 simulators in use");
    expect(
      planStarts(
        [heavy("a")],
        groups(),
        green({ heavyStarting: 1 }),
        T0
      ).explain.get("a")?.text
    ).toBe("Waiting: a simulator is booting on this machine");
    expect(
      planStarts(
        [heavy("a")],
        groups(),
        green({
          lastHeavyStartAt: T0 - HEAVY_START_GAP_MS + 1000,
          lastAutoStartAt: T0 - START_GAP_MS - 1,
        }),
        T0
      ).explain.get("a")?.code
    ).toBe("heavy");
    const amberHeavy = planStarts(
      [heavy("a")],
      groups(),
      green({ level: "amber" }),
      T0
    );
    expect(amberHeavy.explain.get("a")?.code).toBe("load_amber");
    const blockingHeavy = planStarts(
      [cand("a", { heavy: true, priority: "blocking" })],
      groups(),
      green({ level: "amber" }),
      T0
    );
    expect(blockingHeavy.explain.get("a")?.text).toMatch(
      /simulator work starts on green/
    );
  });

  it("holds a task that needs a simulator the machine can't give", () => {
    const plan = planStarts(
      [cand("a", { needsUnmet: true })],
      groups(),
      green(),
      T0
    );
    expect(plan.explain.get("a")?.code).toBe("needs");
  });

  it("starts nothing past the slot limit and shows its rank", () => {
    const plan = planStarts(
      [
        cand("a", { position: 1 }),
        cand("b", { position: 2, priority: "blocking" }),
      ],
      groups(4, 4),
      green(),
      T0
    );
    expect(plan.start).toEqual([]);
    expect(plan.explain.get("b")).toMatchObject({
      code: "slot",
      text: "#1 of 2 · blocking",
    });
    expect(plan.explain.get("a")?.text).toBe("#2 of 2");
  });

  it("an orchestrator or window hold shows instead of the machine", () => {
    const plan = planStarts(
      [
        cand("a", {
          auto: {
            code: "orch_paused",
            text: "Waiting: the orchestrator is paused",
          },
        }),
      ],
      groups(),
      green(),
      T0
    );
    expect(plan.explain.get("a")?.code).toBe("orch_paused");
  });
});

describe("after any", () => {
  const anyOf = (
    finished: string[],
    used: string[] = [],
    ids = ["r1", "r2", "r3"]
  ) => ({
    ids,
    finished,
    used,
    released: false,
    label: "R1, R2",
  });

  it("one finish releases one waiter", () => {
    const plan = planStarts(
      [
        cand("m1", { position: 1, any: anyOf(["r3"]) }),
        cand("m2", { position: 2, any: anyOf(["r3"]) }),
        cand("m3", { position: 3, any: anyOf(["r3"]) }),
      ],
      groups(2, 9),
      green(),
      T0
    );
    expect(plan.start).toEqual(["m1"]);
    expect(plan.consume.get("m1")).toBe("r3");
    expect(plan.explain.get("m2")).toMatchObject({
      code: "after_any",
      text: "Waiting: after any running task (R1, R2)",
    });
  });

  it("a finish already used by another waiter doesn't release this one", () => {
    const plan = planStarts(
      [cand("m2", { any: anyOf(["r3"], ["r3"]) })],
      groups(),
      green(),
      T0
    );
    expect(plan.explain.get("m2")?.code).toBe("after_any");
  });

  it("is released once every task in its set has finished, even if each finish was used", () => {
    const all = ["r1", "r2", "r3"];
    const plan = planStarts(
      [cand("m3", { any: anyOf(all, all) })],
      groups(),
      green(),
      T0
    );
    expect(plan.start).toEqual(["m3"]);
    expect(plan.consume.get("m3")).toBeNull();
  });

  it("a retry that already took a finish isn't held again", () => {
    const plan = planStarts(
      [cand("m1", { any: { ...anyOf([]), released: true } })],
      groups(),
      green(),
      T0
    );
    expect(plan.start).toEqual(["m1"]);
  });
});

describe("the 2026-10-13 replay", () => {
  const anyOf = (
    finished: string[],
    used: string[],
    ids: string[],
    label: string
  ) => ({
    ids,
    finished,
    used,
    released: false,
    label,
  });
  const queuedAt = (m: number) => T0 - min(m);

  it("starts one simulator task at 14:00, Q4 a minute later, the next when the Mac is calm again", () => {
    const heavy = (id: string, position: number, any: Candidate["any"]) =>
      cand(id, { position, heavy: true, waitingSinceMs: queuedAt(50), any });
    const q4 = (position: number) =>
      cand("q4", { position, waitingSinceMs: queuedAt(20) });

    // 14:00 — R3 finished; R1 and R2 still run; one slot (3 of 4 used).
    let plan = planStarts(
      [
        heavy("m1", 1, anyOf(["r3"], [], ["r1", "r2", "r3"], "R1, R2")),
        heavy("m2", 2, anyOf(["r3"], [], ["r1", "r2", "r3"], "R1, R2")),
        heavy("m3", 3, anyOf(["r3"], [], ["r1", "r2", "r3"], "R1, R2")),
        q4(4),
      ],
      groups(2, 4),
      green(),
      T0
    );
    expect(plan.start).toEqual(["m1"]);
    expect(plan.explain.get("m1")?.score).toBe(225);
    expect(plan.explain.get("q4")).toMatchObject({
      code: "spacing",
      score: 210,
    });

    // 14:01 — M1 is starting (a simulator boots); Q4 takes its slot.
    plan = planStarts(
      [
        heavy("m2", 2, anyOf(["r3"], ["r3"], ["r1", "r2", "r3"], "R1, R2")),
        heavy("m3", 3, anyOf(["r3"], ["r3"], ["r1", "r2", "r3"], "R1, R2")),
        q4(4),
      ],
      groups(3, 4),
      green({ lastAutoStartAt: T0, lastHeavyStartAt: T0, heavyStarting: 1 }),
      T0 + min(1)
    );
    expect(plan.start).toEqual(["q4"]);

    // 14:20 — R1 finished; the Mac is amber while M1 builds.
    const at1420 = T0 + min(20);
    plan = planStarts(
      [
        heavy("m2", 2, anyOf(["r1", "r3"], ["r3"], ["r1", "r2", "r3"], "R2")),
        heavy("m3", 3, anyOf(["r1", "r3"], ["r3"], ["r1", "r2", "r3"], "R2")),
      ],
      groups(3, 4),
      green({ level: "amber", booted: 1 }),
      at1420
    );
    expect(plan.start).toEqual([]);
    expect(plan.explain.get("m2")?.code).toBe("load_amber");

    // 14:31 — green again (11 minutes since M1 started): M2 takes R1's finish.
    plan = planStarts(
      [
        heavy("m2", 2, anyOf(["r1", "r3"], ["r3"], ["r1", "r2", "r3"], "R2")),
        heavy("m3", 3, anyOf(["r1", "r3"], ["r3"], ["r1", "r2", "r3"], "R2")),
      ],
      groups(3, 4),
      green({ booted: 1, lastAutoStartAt: T0 + min(1), lastHeavyStartAt: T0 }),
      T0 + min(31)
    );
    expect(plan.start).toEqual(["m2"]);
    expect(plan.consume.get("m2")).toBe("r1");
    expect(plan.explain.get("m3")?.code).toBe("after_any");
  });
});
