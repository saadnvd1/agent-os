import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStatusSource, subscribeStream } from "../status/hub";
import {
  enterStage,
  finishSetup,
  logStep,
  startSetup,
  type SetupView,
} from "./setup-progress";

// What the numbered stream says changed, as each step of a setup happens.
describe("setup progress is pushed", () => {
  let seen: { type: string; topics?: string[] }[] = [];
  let off: () => void = () => {};
  const changed = async () => {
    await vi.advanceTimersByTimeAsync(60);
    const topics = seen
      .filter((m) => m.type === "changed")
      .flatMap((m) => m.topics ?? []);
    seen = [];
    return topics;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    setStatusSource(
      async () => ({ statuses: {}, hostErrors: {} }),
      async () => null
    );
    seen = [];
    off = subscribeStream((json) => seen.push(JSON.parse(json)));
    await vi.advanceTimersByTimeAsync(60);
    seen = [];
  });

  afterEach(() => {
    off();
    vi.useRealTimers();
  });

  it("as it starts, moves stage, logs a step and finishes", async () => {
    const view = startSetup("s-push", "branch");
    expect(await changed()).toEqual(["setup:s-push"]);
    enterStage(view, "deps");
    expect(await changed()).toEqual(["setup:s-push"]);
    logStep(view, { name: "install", command: "npm ci", success: false });
    expect(await changed()).toEqual(["setup:s-push"]);
    finishSetup("s-push", view, "install failed");
    expect(await changed()).toEqual(["setup:s-push"]);
  });

  it("says nothing for a view no setup started", async () => {
    const stray: SetupView = {
      status: "running",
      stages: [],
      log: [],
      branch: null,
      error: null,
      startedAt: 0,
    };
    enterStage(stray, "deps");
    expect(await changed()).toEqual([]);
  });
});
