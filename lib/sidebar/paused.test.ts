import { describe, expect, it } from "vitest";
import { pauseSubtitle } from "./paused";

const NOW = Date.parse("2026-10-14T15:00:00Z");

describe("pauseSubtitle", () => {
  it("says when it resumes, in the reader's zone", () => {
    expect(
      pauseSubtitle(
        { state: "paused", until: Date.parse("2026-10-15T14:00:00Z") },
        NOW,
        "America/Chicago"
      )
    ).toBe("Paused · resumes Tomorrow 9 AM");
    expect(
      pauseSubtitle(
        { state: "paused", until: NOW + 3_600_000 },
        NOW,
        "America/Chicago"
      )
    ).toBe("Paused · resumes 11 AM");
  });

  it("says until you resume, and the states between", () => {
    expect(pauseSubtitle({ state: "paused", until: null }, NOW)).toBe(
      "Paused until you resume"
    );
    expect(pauseSubtitle({ state: "pausing", until: null }, NOW)).toBe(
      "Pausing · finishing its step"
    );
    expect(pauseSubtitle({ state: "resuming", until: null }, NOW)).toBe(
      "Resuming · waiting for a slot"
    );
  });
});
