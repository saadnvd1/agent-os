import { describe, expect, it } from "vitest";
import { liveParts, liveText } from "./live-status";
import type { PrStage } from "../tasks/pr-stage";

const stage = (s: PrStage["stage"]): PrStage => ({
  stage: s,
  number: 232,
  url: "https://example.test/pull/232",
});

describe("liveParts", () => {
  it("is empty with nothing to say", () => {
    expect(liveParts({})).toEqual([]);
  });

  it("joins compacting and the PR stage", () => {
    const parts = liveParts({
      compacting: true,
      prStage: stage("ci-running"),
    });
    expect(liveText(parts)).toBe("Compacting · PR CI");
    expect(parts.map((p) => p.busy)).toEqual([true, true]);
  });

  it("says a bare open PR as PR, and an armed one as idle", () => {
    expect(liveText(liveParts({ prStage: stage("open") }))).toBe("PR");
    const [armed] = liveParts({ prStage: stage("armed") });
    expect(armed).toMatchObject({ text: "PR Armed", tone: "green" });
    expect(armed.busy).toBe(false);
  });
});

describe("liveParts plan badge", () => {
  const planning = {
    kind: "planning" as const,
    label: "Planning",
    tip: "t",
  };
  const ready = { kind: "plan-ready" as const, label: "Plan ready", tip: "t" };

  it("puts Planning and Plan ready on the second line, before the PR", () => {
    expect(liveText(liveParts({ badge: planning }))).toBe("Planning");
    expect(liveText(liveParts({ badge: ready, prStage: stage("open") }))).toBe(
      "Plan ready · PR"
    );
    expect(liveParts({ badge: ready })[0]).toMatchObject({
      badge: "plan-ready",
      tone: "primary",
    });
  });
});

describe("liveParts status badges", () => {
  it("carries a need or a stall as a badge part", () => {
    expect(
      liveParts({ badge: { kind: "need", label: "Needs you 2" } })[0]
    ).toMatchObject({ text: "Needs you 2", tone: "amber", badge: "need" });
    expect(
      liveParts({ badge: { kind: "failed", label: "Failed" } })[0]
    ).toMatchObject({ tone: "red" });
  });
});
