import { describe, expect, it } from "vitest";
import {
  HEAVY_START_GAP_MS,
  HOLD_ORDER,
  LOAD_SETTLE_MS,
  START_GAP_MS,
  clearsByItself,
  holdReason,
  holdText,
  holdsFor,
  placeable,
  queueNote,
  resumeNote,
  type Hold,
  type HoldContext,
  type MachineView,
} from "./holds";
import type { Candidate } from "./schedule";
import type { WaitCode } from "./schedule-types";

const T0 = Date.UTC(2026, 9, 15, 14, 0, 0);

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

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: "a",
  kind: "start",
  group: "g",
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

const ctx = (over: Partial<HoldContext> = {}): HoldContext => ({
  machine: green(),
  now: T0,
  used: new Set(),
  inFlight: 0,
  limit: Infinity,
  rank: 1,
  of: 1,
  ...over,
});

const any = (over: Partial<NonNullable<Candidate["any"]>> = {}) => ({
  ids: ["x", "y"],
  finished: [],
  used: [],
  released: false,
  label: "x, y",
  ...over,
});

interface Row {
  name: string;
  c?: Partial<Candidate>;
  x?: Partial<HoldContext>;
  codes: WaitCode[];
  head?: string;
}

const ROWS: Row[] = [
  { name: "nothing holds it", codes: [] },
  {
    name: "after",
    c: { before: { code: "after", text: "After Build" } },
    codes: ["after"],
    head: "After Build",
  },
  {
    name: "after any, none finished",
    c: { any: any() },
    codes: ["after_any"],
    head: "Waiting: after any running task (x, y)",
  },
  {
    name: "after any, one finished and free",
    c: { any: any({ finished: ["x"] }) },
    codes: [],
  },
  {
    name: "after any, the finish was taken by another waiter",
    c: { any: any({ finished: ["x"] }) },
    x: { used: new Set(["x"]) },
    codes: ["after_any"],
  },
  {
    name: "after any, the whole set finished and taken",
    c: { any: any({ finished: ["x", "y"] }) },
    x: { used: new Set(["x", "y"]) },
    codes: [],
  },
  {
    name: "after any, already released",
    c: { any: any({ released: true }) },
    codes: [],
  },
  {
    name: "orchestrator paused",
    c: { auto: { code: "orch_paused", text: "Waiting: paused" } },
    codes: ["orch_paused"],
  },
  {
    name: "usage window",
    c: { auto: { code: "window", text: "Waiting: window" } },
    codes: ["window"],
  },
  {
    name: "paused and window, both listed",
    c: {
      auto: [
        { code: "orch_paused", text: "Waiting: paused" },
        { code: "window", text: "Waiting: window" },
      ],
    },
    codes: ["orch_paused", "window"],
    head: "Waiting: paused",
  },
  {
    name: "needs a Mac",
    c: { needsUnmet: true },
    codes: ["needs"],
    head: "Waiting: needs a Mac",
  },
  {
    name: "needs a Mac with load checks off",
    c: { needsUnmet: true },
    x: { machine: green({ enabled: false, level: "red", settled: false }) },
    codes: ["needs"],
  },
  {
    name: "load checks off",
    x: { machine: green({ enabled: false, level: "red" }) },
    c: { heavy: true },
    codes: [],
  },
  {
    name: "no reading yet",
    x: { machine: green({ reading: true, lastAutoStartAt: T0 }) },
    codes: ["load_red"],
    head: "Waiting: reading machine load",
  },
  {
    name: "red",
    x: { machine: green({ level: "red", settled: false }) },
    codes: ["load_red"],
    head: "Waiting: this machine load red",
  },
  {
    name: "calm again, still settling",
    x: {
      machine: green({ settled: false, settleLeftMs: 30_000 }),
    },
    codes: ["load_red"],
    head: "Waiting: this machine load was red; calm for 30s more",
  },
  {
    name: "amber holds normal work",
    x: { machine: green({ level: "amber" }) },
    codes: ["load_amber"],
    head: "Waiting: this machine load amber; normal work starts on green",
  },
  {
    name: "amber lets blocking through",
    c: { priority: "blocking" },
    x: { machine: green({ level: "amber" }) },
    codes: [],
  },
  {
    name: "amber and a simulator task: both",
    c: { heavy: true },
    x: { machine: green({ level: "amber" }) },
    codes: ["load_amber", "heavy"],
  },
  {
    name: "amber holds a blocking simulator task",
    c: { heavy: true, priority: "blocking" },
    x: { machine: green({ level: "amber" }) },
    codes: ["heavy"],
    head: "Waiting: this machine load amber; simulator work starts on green",
  },
  {
    name: "a simulator is booting",
    c: { heavy: true },
    x: { machine: green({ heavyStarting: 1 }) },
    codes: ["heavy"],
    head: "Waiting: a simulator is booting on this machine",
  },
  {
    name: "all simulators in use",
    c: { heavy: true },
    x: { machine: green({ booted: 2 }) },
    codes: ["heavy"],
    head: "Waiting: 2 of 2 simulators in use",
  },
  {
    name: "a simulator task just started",
    c: { heavy: true },
    x: { machine: green({ lastHeavyStartAt: T0 - 60_000 }) },
    codes: ["heavy"],
    head: "Waiting: a simulator task just started on this machine (next in 240s)",
  },
  {
    name: "start spacing",
    x: { machine: green({ lastAutoStartAt: T0 - 10_000 }) },
    codes: ["spacing"],
    head: "Waiting: spacing starts (next in 50s)",
  },
  {
    name: "spacing passed",
    x: { machine: green({ lastAutoStartAt: T0 - START_GAP_MS }) },
    codes: [],
  },
  {
    name: "slot limit full",
    x: { inFlight: 2, limit: 2, rank: 2, of: 3 },
    c: { priority: "urgent" },
    codes: ["slot"],
    head: "#2 of 3 · urgent",
  },
  {
    name: "plan-only skips the machine and the slot limit",
    c: { planOnly: true, needsUnmet: true, heavy: true },
    x: {
      machine: green({ level: "red", lastAutoStartAt: T0 }),
      inFlight: 5,
      limit: 1,
    },
    codes: [],
  },
  {
    name: "plan-only still waits out a Pause",
    c: {
      planOnly: true,
      auto: { code: "orch_paused", text: "Waiting: paused" },
    },
    codes: ["orch_paused"],
  },
  {
    name: "remote: this machine's load doesn't matter",
    c: { remote: true, heavy: true, needsUnmet: true },
    x: { machine: green({ level: "red", lastAutoStartAt: T0 }) },
    codes: [],
  },
  {
    name: "remote still waits for a slot",
    c: { remote: true },
    x: { inFlight: 1, limit: 1 },
    codes: ["slot"],
  },
  {
    name: "everything at once, in order",
    c: {
      heavy: true,
      needsUnmet: true,
      before: { code: "after", text: "After Build" },
      any: any(),
      auto: [
        { code: "orch_paused", text: "Waiting: paused" },
        { code: "window", text: "Waiting: window" },
      ],
    },
    x: {
      machine: green({ level: "amber", lastAutoStartAt: T0 - 1000 }),
      inFlight: 1,
      limit: 1,
    },
    codes: [
      "after",
      "after_any",
      "orch_paused",
      "window",
      "needs",
      "load_amber",
      "heavy",
      "spacing",
      "slot",
    ],
  },
];

describe("holdsFor", () => {
  it.each(ROWS)("$name", ({ c, x, codes, head }) => {
    const holds = holdsFor(cand(c), ctx(x));
    expect(holds.map((h) => h.code)).toEqual(codes);
    if (head !== undefined) expect(holds[0].text).toBe(head);
  });

  it("every row reports its holds in HOLD_ORDER", () => {
    for (const { c, x } of ROWS) {
      const at = holdsFor(cand(c), ctx(x)).map((h) =>
        HOLD_ORDER.indexOf(h.code)
      );
      expect(at).toEqual([...at].sort((a, b) => a - b));
    }
  });

  it("names the order", () => {
    expect(HOLD_ORDER).toEqual([
      "after",
      "after_any",
      "orch_paused",
      "window",
      "needs",
      "load_red",
      "load_amber",
      "heavy",
      "spacing",
      "slot",
    ]);
  });

  it("a machine hold says which machine, and when it lifts", () => {
    const [settling] = holdsFor(
      cand(),
      ctx({ machine: green({ settled: false, settleLeftMs: 30_000 }) })
    );
    expect(settling).toMatchObject({
      machine: "this machine",
      until: T0 + 30_000,
    });
    expect(LOAD_SETTLE_MS).toBeGreaterThan(30_000);
    const [heavy] = holdsFor(
      cand({ heavy: true }),
      ctx({ machine: green({ lastHeavyStartAt: T0 - 1000 }) })
    );
    expect(heavy).toMatchObject({ until: T0 - 1000 + HEAVY_START_GAP_MS });
    const [spacing] = holdsFor(
      cand(),
      ctx({ machine: green({ lastAutoStartAt: T0 - 1000 }) })
    );
    expect(spacing).toMatchObject({ until: T0 - 1000 + START_GAP_MS });
    const [red] = holdsFor(
      cand(),
      ctx({ machine: green({ level: "red", settled: false }) })
    );
    expect(red).not.toHaveProperty("until");
  });
});

describe("what a hold says about itself", () => {
  it("clears by itself unless a person or the hardware has to change", () => {
    const by = Object.fromEntries(
      HOLD_ORDER.map((code) => [code, clearsByItself({ code } as Hold)])
    );
    expect(by).toEqual({
      after: true,
      after_any: true,
      orch_paused: false,
      window: true,
      needs: false,
      load_red: true,
      load_amber: true,
      heavy: true,
      spacing: true,
      slot: true,
    });
  });

  it("only the machine's load and needs can be lifted by a linked machine", () => {
    expect(HOLD_ORDER.filter((code) => placeable({ code }))).toEqual([
      "needs",
      "load_red",
      "load_amber",
      "heavy",
    ]);
  });

  const red = holdsFor(
    cand(),
    ctx({ machine: green({ level: "red", settled: false }) })
  )[0];

  it("holdText adds why it stays here; holdReason drops the lead", () => {
    expect(holdText(red)).toBe("Waiting: this machine load red");
    const stayed = { ...red, stay: "it was pinned to a machine" } as Hold;
    expect(holdText(stayed)).toBe(
      "Waiting: this machine load red (it was pinned to a machine)"
    );
    expect(holdReason(stayed)).toBe(
      "this machine load red (it was pinned to a machine)"
    );
    expect(holdReason({ code: "after", text: "After Build" })).toBe(
      "After Build"
    );
  });

  it("queueNote is the first hold, or empty when it starts, or unknown", () => {
    expect(queueNote([red])).toEqual({
      code: "load_red",
      text: "Waiting: this machine load red",
    });
    expect(queueNote([])).toEqual({ code: null, text: null });
    expect(queueNote(undefined)).toBeNull();
  });

  it("resumeNote says what holds it, else where it is in line", () => {
    expect(resumeNote(undefined, { running: 0, limit: null })).toBeNull();
    expect(resumeNote([red], { running: 1, limit: 2 })).toBe(
      "held: this machine load red"
    );
    const slot: Hold = { code: "slot", text: "#1 of 1" };
    expect(resumeNote([slot], { running: 2, limit: 2 })).toBe(
      "resuming: waiting for a slot, 2 of 2 running"
    );
    expect(resumeNote([], { running: 0, limit: null })).toBe(
      "resuming: waiting for its turn"
    );
  });
});
