import { describe, expect, it } from "vitest";
import { orchestratorRowText } from "./orchestrator-row";

const quiet = { asks: 0, paused: false, running: 0, inReview: 0 };

describe("orchestratorRowText", () => {
  it("shows the open asks count, singular and plural", () => {
    const idle = { need: null, working: false };
    expect(orchestratorRowText(idle, quiet).asks).toBeNull();
    expect(orchestratorRowText(idle, { ...quiet, asks: 1 }).asks).toBe("1 ask");
    expect(orchestratorRowText(idle, { ...quiet, asks: 3 }).asks).toBe(
      "3 asks"
    );
  });

  it("says what it's doing, paused first, with the workspace's counts", () => {
    expect(
      orchestratorRowText({ need: null, working: true }, quiet).status
    ).toBe("Working");
    expect(
      orchestratorRowText(
        { need: "answer", working: true },
        { ...quiet, paused: true, running: 2, inReview: 1 }
      ).status
    ).toBe("Paused · 2 running · 1 in review");
    expect(
      orchestratorRowText({ need: "failed", working: false }, quiet).status
    ).toBe("Failed");
    expect(
      orchestratorRowText({ need: null, working: false }, quiet).status
    ).toBe("Idle");
  });
});
