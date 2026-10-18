import { describe, expect, it } from "vitest";
import {
  armedStuck,
  bgQuiet,
  ciLimit,
  ciSlow,
  duration,
  loadRed,
  matchingMerge,
  overlap,
  queueHeld,
  restarts,
  runDetectors,
  serverErrors,
} from "./detectors";
import { NOW, config, facts } from "./fixtures";
import { MIN } from "./types";

const machine = (redMin: number | null, level = "red" as const) => ({
  id: "local",
  label: "This machine",
  level,
  redSince: redMin === null ? null : NOW - redMin * MIN,
});

describe("load-red", () => {
  it("trips once red has lasted the threshold, not before", () => {
    const c = config();
    expect(loadRed(facts({ machines: [machine(9)] }), c)).toEqual([]);
    const [t] = loadRed(facts({ machines: [machine(11)] }), c);
    expect(t).toMatchObject({
      check: "load-red",
      subject: "local",
      severity: "warn",
    });
    expect(t.line).toContain("11m");
  });
  it("is high at three times the threshold, and never when not red", () => {
    expect(
      loadRed(facts({ machines: [machine(31)] }), config())[0].severity
    ).toBe("high");
    expect(
      loadRed(facts({ machines: [machine(null, "red")] }), config())
    ).toEqual([]);
  });
  it("follows a changed threshold", () => {
    expect(
      loadRed(facts({ machines: [machine(4)] }), config({ loadRedMinutes: 3 }))
    ).toHaveLength(1);
  });
});

describe("queue-held", () => {
  const q = (ageMin: number) => ({
    id: "q1",
    name: "add-auth",
    projectId: "p",
    workspaceId: "w",
    createdAt: NOW - ageMin * MIN,
    heldBy: "the machine is busy",
  });
  it("trips after an hour and names what holds it", () => {
    expect(queueHeld(facts({ queue: [q(59)] }), config())).toEqual([]);
    const [t] = queueHeld(facts({ queue: [q(61)] }), config());
    expect(t.line).toContain("held 1h 1m");
    expect(t.line).toContain("the machine is busy");
    expect(t.workspaceId).toBe("w");
  });
});

describe("bg-quiet", () => {
  const job = (outputMin: number | null) => ({
    sessionId: "s1",
    sessionName: "fix-login",
    workspaceId: "w",
    taskId: "t1",
    description: "xcodebuild test",
    startedAt: NOW - 30 * MIN,
    outputAt: outputMin === null ? null : NOW - outputMin * MIN,
  });
  it("trips on a job quiet for 20 minutes", () => {
    expect(bgQuiet(facts({ bg: [job(19)] }), config())).toEqual([]);
    const [t] = bgQuiet(facts({ bg: [job(21)] }), config());
    expect(t.subject).toBe("s1:t1");
    expect(t.line).toContain("quiet 21m");
  });
  it("counts from the start when it never printed, and says so", () => {
    const [t] = bgQuiet(facts({ bg: [job(null)] }), config());
    expect(t.line).toContain("printed nothing in 30m");
    expect(t.detail.neverPrinted).toBe(true);
  });
});

describe("restarts", () => {
  it("trips past two restarts in the window, high", () => {
    const boots = (n: number) =>
      Array.from({ length: n }, (_, i) => NOW - i * 5 * MIN);
    expect(restarts(facts({ boots: boots(2) }), config())).toEqual([]);
    const [t] = restarts(facts({ boots: boots(3) }), config());
    expect(t).toMatchObject({ subject: "server", severity: "high" });
  });
  it("leaves autodeploy's planned restarts out of the count", () => {
    const boots = (n: number) =>
      Array.from({ length: n }, (_, i) => NOW - i * 5 * MIN);
    expect(
      restarts(facts({ boots: boots(2), deploys: boots(3) }), config())
    ).toEqual([]);
    const [t] = restarts(
      facts({ boots: boots(3), deploys: [NOW - MIN] }),
      config()
    );
    expect(t.line).toContain("besides 1 autodeploy restart)");
  });
  it("ignores starts outside the window", () => {
    expect(
      restarts(
        facts({
          boots: [
            NOW,
            NOW - 2 * 60 * MIN,
            NOW - 3 * 60 * MIN,
            NOW - 4 * 60 * MIN,
          ],
        }),
        config()
      )
    ).toEqual([]);
  });
});

describe("ci-slow", () => {
  const run = (pendingMin: number, baseline: number[]) => ({
    projectId: "p",
    workspaceId: "w",
    prNumber: 7,
    head: "abcdef123456",
    pendingSince: NOW - pendingMin * MIN,
    baseline,
  });
  it("uses the fallback with fewer than five past runs", () => {
    expect(ciLimit([5 * MIN], 20 * MIN)).toBe(20 * MIN);
    expect(ciSlow(facts({ ci: [run(19, [])] }), config())).toEqual([]);
    expect(ciSlow(facts({ ci: [run(21, [])] }), config())).toHaveLength(1);
  });
  it("learns the usual duration: twice the median, or the slow tenth plus five minutes", () => {
    const five = Array(10).fill(5 * MIN);
    expect(ciLimit(five, 20 * MIN)).toBe(10 * MIN);
    expect(ciSlow(facts({ ci: [run(9, five)] }), config())).toEqual([]);
    const [t] = ciSlow(facts({ ci: [run(11, five)] }), config());
    expect(t.line).toContain("usually settles within 10m");
    const spread = [4, 4, 4, 4, 4, 4, 4, 4, 4, 14].map((m) => m * MIN);
    expect(ciLimit(spread, 20 * MIN)).toBe(19 * MIN);
  });
});

describe("armed-stuck", () => {
  it("trips after two hours armed", () => {
    const a = (m: number) => ({
      sessionId: "s",
      name: "add-auth",
      workspaceId: "w",
      armedAt: NOW - m * MIN,
      prNumber: 9,
    });
    expect(armedStuck(facts({ armed: [a(119)] }), config())).toEqual([]);
    expect(armedStuck(facts({ armed: [a(121)] }), config())[0].line).toContain(
      "armed 2h 1m"
    );
  });
});

describe("server-errors", () => {
  it("needs the floor and a multiple of the usual rate", () => {
    expect(
      serverErrors(facts({ errors: { recent: 19, baselineMean: 0 } }), config())
    ).toEqual([]);
    expect(
      serverErrors(facts({ errors: { recent: 20, baselineMean: 0 } }), config())
    ).toHaveLength(1);
    expect(
      serverErrors(
        facts({ errors: { recent: 30, baselineMean: 10 } }),
        config()
      )
    ).toEqual([]);
    expect(
      serverErrors(
        facts({ errors: { recent: 50, baselineMean: 10 } }),
        config()
      )[0].severity
    ).toBe("warn");
    expect(
      serverErrors(
        facts({ errors: { recent: 100, baselineMean: 10 } }),
        config()
      )[0].severity
    ).toBe("high");
  });
});

describe("piece-dup matching", () => {
  it("scores shared wording, ignoring filler", () => {
    expect(
      overlap("Health panel UI", "feat: health panel page for the UI")
    ).toBe(1);
    expect(overlap("Health panel UI", "fix login redirect")).toBe(0);
  });
  it("picks the best merged work over the threshold", () => {
    const merged = [
      { sessionId: "a", prNumber: 1, text: "fix login redirect" },
      { sessionId: "b", prNumber: 2, text: "health panel in settings" },
    ];
    expect(
      matchingMerge(
        { name: "Health panel", slice: "settings tab" },
        merged,
        0.4
      )?.work.sessionId
    ).toBe("b");
    expect(
      matchingMerge({ name: "Billing export", slice: "csv" }, merged, 0.4)
    ).toBeNull();
  });
});

describe("runDetectors", () => {
  it("returns nothing for a quiet system", () => {
    expect(runDetectors(facts(), config())).toEqual([]);
  });
  it("formats durations", () => {
    expect(duration(59 * MIN)).toBe("59m");
    expect(duration(125 * MIN)).toBe("2h 5m");
  });
});
