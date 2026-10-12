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
