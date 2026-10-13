import { describe, expect, it } from "vitest";
import { bannerState, type UpdateRun, type UpdateView } from "./banner";

const view = (over: Partial<UpdateView> = {}): UpdateView => ({
  current: { version: "0.3.1", sha: "a" },
  latest: { version: "0.3.5", sha: "b", notes: ["x"], url: null },
  available: true,
  behind: 4,
  status: "ok",
  checkedAt: 1,
  checkError: null,
  bannerEnabled: true,
  bannerLocked: false,
  canUpdate: { ok: true },
  run: null,
  pending: null,
  working: { sessions: 0, reviews: 0, setups: 0 },
  ...over,
});
const run = (phase: UpdateRun["phase"]): UpdateRun => ({
  id: "r1",
  phase,
  from: "a",
  fromVersion: "0.3.1",
  toVersion: "0.3.5",
  startedAt: 1,
});
const none = { dismissedVersion: null, dismissedRun: null };

describe("bannerState", () => {
  it("shows an available version", () => {
    expect(bannerState({ view: view(), ...none })).toBe("available");
  });

  it("is hidden when there is nothing newer, no data, or the banner is off", () => {
    expect(bannerState({ view: view({ available: false }), ...none })).toBe(
      "hidden"
    );
    expect(bannerState({ view: null, ...none })).toBe("hidden");
    expect(bannerState({ view: view({ bannerEnabled: false }), ...none })).toBe(
      "hidden"
    );
  });

  it("dismissal hides that version only", () => {
    const dismissed = { dismissedVersion: "0.3.5", dismissedRun: null };
    expect(bannerState({ view: view(), ...dismissed })).toBe("hidden");
    const next = view({
      latest: { version: "0.3.6", sha: "c", notes: [], url: null },
    });
    expect(bannerState({ view: next, ...dismissed })).toBe("available");
  });

  it("shows a run in progress even when dismissed or switched off", () => {
    const v = view({ run: run("building"), bannerEnabled: false });
    expect(
      bannerState({ view: v, dismissedVersion: "0.3.5", dismissedRun: "r1" })
    ).toBe("running");
  });

  it("shows a failed or built run until that run is dismissed", () => {
    for (const phase of ["failed", "built"] as const) {
      const v = view({ run: run(phase), available: false });
      expect(bannerState({ view: v, ...none })).toBe(phase);
      expect(
        bannerState({ view: v, dismissedVersion: null, dismissedRun: "r1" })
      ).toBe("hidden");
    }
  });

  it("a finished run needs no banner, and a pending one shows", () => {
    expect(
      bannerState({
        view: view({ run: run("done"), available: false }),
        ...none,
      })
    ).toBe("hidden");
    expect(
      bannerState({ view: view({ pending: { requestedAt: 1 } }), ...none })
    ).toBe("pending");
  });
});
