import { describe, expect, it } from "vitest";
import { headerLine, needCount } from "./header-line";

describe("the workspace header line", () => {
  it("reads from the live counts, leaving out what's zero", () => {
    expect(
      headerLine({ running: 3, inReview: 1, asks: 1, paused: false })
    ).toBe("Orchestrator · 3 running · 1 in review · 1 ask");
    expect(headerLine({ running: 0, inReview: 0, asks: 2, paused: true })).toBe(
      "Orchestrator · paused · 2 asks"
    );
    expect(
      headerLine({ running: 0, inReview: 0, asks: 0, paused: false })
    ).toBe("Orchestrator · all quiet");
  });

  it("counts an orchestrator once per open ask in N need you", () => {
    expect(needCount({ status: "waiting", asks: 3 })).toBe(3);
    expect(needCount({ status: "waiting" })).toBe(1);
    expect(needCount({ status: "idle", asks: 3 })).toBe(0);
    expect(needCount(undefined)).toBe(0);
  });
});
