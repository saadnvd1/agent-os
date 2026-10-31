import { describe, expect, it } from "vitest";
import {
  UPDATED_NOTE_MS,
  bannerState,
  type UpdateRun,
  type UpdateView,
} from "./banner";

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
  canRestart: true,
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

  it("an automatic update says it happened, for a few days, until dismissed", () => {
    const done = {
      ...run("done"),
      auto: true,
      finishedAt: 1_000,
    };
    const v = view({ available: false, run: done });
    expect(bannerState({ view: v, ...none, now: 2_000 })).toBe("updated");
    expect(
      bannerState({ view: v, ...none, now: 1_000 + UPDATED_NOTE_MS })
    ).toBe("hidden");
    expect(
      bannerState({
        view: v,
        dismissedVersion: null,
        dismissedRun: "r1",
        now: 2_000,
      })
    ).toBe("hidden");
    // One someone started reloads the page instead.
    expect(
      bannerState({
        view: view({ available: false, run: { ...done, auto: false } }),
        ...none,
        now: 2_000,
      })
    ).toBe("hidden");
  });

  it("a rollback shows, and an automatic build failure only when it left things broken", () => {
    expect(
      bannerState({ view: view({ run: run("rolled_back") }), ...none })
    ).toBe("rolled_back");
    const failed = {
      ...run("failed"),
      auto: true,
      outcome: "build_failed" as const,
    };
    expect(
      bannerState({ view: view({ available: false, run: failed }), ...none })
    ).toBe("hidden");
    expect(
      bannerState({
        view: view({ run: { ...failed, outcome: "broken" } }),
        ...none,
      })
    ).toBe("failed");
  });

  it("the new phases count as running", () => {
    for (const p of ["backing_up", "verifying", "rolling_back"] as const)
      expect(bannerState({ view: view({ run: run(p) }), ...none })).toBe(
        "running"
      );
  });
});
