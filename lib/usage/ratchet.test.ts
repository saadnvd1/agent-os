import { describe, expect, it } from "vitest";
import { USAGE_DEFAULTS, type UsageConfig } from "./config";
import {
  biggestMover,
  evaluateAlerts,
  nextAlertState,
  nextBaseline,
  ratchet,
  supportingOf,
  type Baseline,
} from "./ratchet";
import { computeRollup, spanOf, type Rollup } from "./span";

const cfg = (over: Partial<UsageConfig> = {}): UsageConfig => ({
  ...USAGE_DEFAULTS,
  ...over,
});

// A day with `work` weighted tokens and the given merges.
const day = (n: number, over: Partial<Rollup> = {}): Rollup => ({
  ...computeRollup({
    day: `2026-10-${String(n).padStart(2, "0")}`,
    groups: [],
    merged: 10,
    clean: 8,
    fixRounds: 0,
    escalations: 0,
    scopeChanges: 0,
    escapes: 0,
    weeklyPct: null,
    weeklyEstimated: false,
  }),
  work: 1000,
  weighted: 1000,
  ...over,
});
const days = (from: number, count: number, over: Partial<Rollup> = {}) =>
  Array.from({ length: count }, (_, i) => day(from + i, over));

describe("ratchet", () => {
  it("keeps the better value in either direction", () => {
    expect(ratchet(100, 120, "lower")).toBe(100);
    expect(ratchet(100, 80, "lower")).toBe(80);
    expect(ratchet(0.7, 0.6, "higher")).toBe(0.7);
    expect(ratchet(0.7, 0.8, "higher")).toBe(0.8);
  });

  it("ignores a missing or invalid candidate and takes the first value", () => {
    expect(ratchet(100, null, "lower")).toBe(100);
    expect(ratchet(100, NaN, "lower")).toBe(100);
    expect(ratchet(null, 50, "lower")).toBe(50);
    expect(ratchet(null, null, "lower")).toBeNull();
  });
});

describe("nextBaseline floor", () => {
  const quiet = { merged: 0, clean: 0 };

  it("waits when the first week has fewer merges than the floor", () => {
    expect(nextBaseline(null, days(1, 7, quiet), cfg())).toBeNull();
    expect(
      nextBaseline(
        null,
        days(1, 7, { merged: 0, clean: 0 }).map((d, i) =>
          i === 0 ? { ...d, merged: 2, clean: 2 } : d
        ),
        cfg()
      )
    ).toBeNull();
  });

  it("seeds from the latest week once it has enough work", () => {
    const all = [...days(1, 7, quiet), ...days(8, 7)];
    const b = nextBaseline(null, all, cfg())!;
    expect(b.values.cleanRate).toBeCloseTo(0.8);
  });

  it("does not ratchet from a week below the floor", () => {
    const base = nextBaseline(null, days(1, 7), cfg())!;
    const thin = days(8, 7, { merged: 0, clean: 0, work: 1 });
    expect(nextBaseline(base, [...days(1, 7), ...thin], cfg())).toEqual(base);
  });
});

describe("nextBaseline", () => {
  it("waits for a week of rollups, then takes the first week", () => {
    expect(nextBaseline(null, days(1, 6), cfg())).toBeNull();
    const b = nextBaseline(null, days(1, 8, { work: 1000 }), cfg())!;
    expect(b.values.costPerMerged).toBe(100);
    expect(b.values.cleanRate).toBe(0.8);
  });

  it("never loosens, whatever the days after it do", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let b = nextBaseline(null, days(1, 7), cfg(), 1)!;
    let all = days(1, 7);
    for (let i = 0; i < 200; i++) {
      all = [
        ...all,
        day(8 + i, {
          work: Math.round(200 + rand() * 4000),
          clean: Math.floor(rand() * 11),
        }),
      ];
      const next = nextBaseline(b, all, cfg(), i + 2)!;
      expect(next.values.costPerMerged!).toBeLessThanOrEqual(
        b.values.costPerMerged!
      );
      expect(next.values.costPerClean!).toBeLessThanOrEqual(
        b.values.costPerClean ?? Infinity
      );
      expect(next.values.cleanRate!).toBeGreaterThanOrEqual(
        b.values.cleanRate!
      );
      b = next;
    }
  });

  it("moves to a better week and takes that week's supporting snapshot", () => {
    const base = nextBaseline(null, days(1, 7), cfg())!;
    const better = [...days(1, 7), ...days(8, 7, { work: 500 })];
    const next = nextBaseline(base, better, cfg())!;
    expect(next.values.costPerMerged).toBe(50);
  });
});

const baseline = (over: Partial<Baseline["values"]> = {}): Baseline => ({
  values: { costPerMerged: 100, costPerClean: 125, cleanRate: 0.8, ...over },
  supporting: supportingOf(spanOf(days(1, 7, { review: 100 }))),
  setAt: 1,
});
// 3 days, 10 merged each: cost per merged = work / 10.
const recent = (work: number, clean: number, over: Partial<Rollup> = {}) =>
  days(20, 3, { work, clean, ...over });

describe("evaluateAlerts", () => {
  it("fires on cost only past the margin: +15% is quiet, +16% is not", () => {
    expect(evaluateAlerts(recent(1150, 8), baseline(), cfg())).toEqual([]);
    const a = evaluateAlerts(recent(1160, 8), baseline(), cfg());
    expect(a.map((x) => x.kind)).toEqual(["cost"]);
    expect(a[0].message).toContain("16% over baseline");
  });

  it("fires on the clean rate even when cost fell", () => {
    const quiet = evaluateAlerts(recent(500, 7), baseline(), cfg());
    expect(quiet).toEqual([]);
    const a = evaluateAlerts(recent(500, 6), baseline(), cfg());
    expect(a.map((x) => x.kind)).toEqual(["quality"]);
    expect(a[0].message).toContain("20 points under baseline");
  });

  it("stays silent without a baseline, enough days or enough merges", () => {
    expect(evaluateAlerts(recent(9000, 0), null, cfg())).toEqual([]);
    expect(evaluateAlerts(recent(9000, 0).slice(1), baseline(), cfg())).toEqual(
      []
    );
    expect(
      evaluateAlerts(recent(9000, 0, { merged: 0 }), baseline(), cfg())
    ).toEqual([]);
    const thin = recent(9000, 0, { merged: 0 });
    thin[2] = { ...thin[2], merged: 2, clean: 0 };
    expect(evaluateAlerts(thin, baseline(), cfg())).toEqual([]);
  });

  it("takes its margins from the config", () => {
    expect(
      evaluateAlerts(recent(1160, 8), baseline(), cfg({ costPct: 20 }))
    ).toEqual([]);
    expect(
      evaluateAlerts(recent(500, 7), baseline(), cfg({ cleanPoints: 5 })).map(
        (x) => x.kind
      )
    ).toEqual(["quality"]);
  });

  it("names the supporting metric that moved most", () => {
    const a = evaluateAlerts(
      recent(1300, 8, { review: 1000, orchestrator: 12, weighted: 1000 }),
      baseline(),
      cfg()
    );
    expect(a[0].message).toContain("Biggest mover: review cost per PR");
  });
});

describe("biggestMover", () => {
  it("picks the largest adverse change and ignores improvements", () => {
    const s = supportingOf(spanOf(days(1, 3, { review: 100 })));
    const worse = { ...s, reviewPerPr: s.reviewPerPr! * 2, opusShare: 0 };
    expect(biggestMover(s, worse)?.label).toBe("review cost per PR");
    expect(biggestMover(s, { ...s, reviewPerPr: 0 })).toBeNull();
  });
});

describe("nextAlertState", () => {
  it("notifies once while a condition holds, and again after it clears", () => {
    const cost = { kind: "cost" as const, message: "m" };
    let open: string[] = [];
    let s = nextAlertState(open, [cost]);
    expect(s.notify).toEqual([cost]);
    open = ["cost"];
    s = nextAlertState(open, [cost]);
    expect(s).toEqual({ notify: [], clear: [] });
    s = nextAlertState(open, []);
    expect(s).toEqual({ notify: [], clear: ["cost"] });
    expect(nextAlertState([], [cost]).notify).toEqual([cost]);
  });
});

describe("spanOf", () => {
  it("is a ratio of sums, not a mean of daily ratios", () => {
    const rows = [
      day(1, { work: 100, merged: 1, clean: 1 }),
      day(2, { work: 900, merged: 9, clean: 9 }),
    ];
    // Daily ratios are 100 and 100; a mean of ratios and the true ratio
    // agree here, so skew it.
    rows[0].work = 1000;
    expect(spanOf(rows).costPerMerged).toBe((1000 + 900) / 10);
    expect((1000 / 1 + 900 / 9) / 2).not.toBe(190);
  });
});
