import { describe, expect, it } from "vitest";
import { CHAT_ACCESS } from "@/lib/chat/events";
import { RUN_TRIGGERS } from "@/lib/recipes/types";
import { clientConfig } from "./client-config";
import { CLIENT_CONFIG_VERSION } from "./client-config-types";

const TASK_STATES = [
  "working",
  "needs-input",
  "blocked",
  "plan-ready",
  "review",
  "checks-failing",
  "exited",
  "merged",
  "dropped",
  "done",
  "moving",
];
const RUN_STATUSES = [
  "queued",
  "starting",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "timed_out",
  "cancelled",
  "skipped",
];

describe("clientConfig", () => {
  const cfg = clientConfig();

  it("is versioned and carries the server", () => {
    expect(cfg.v).toBe(CLIENT_CONFIG_VERSION);
    expect(Date.parse(cfg.server.startedAt)).not.toBeNaN();
  });

  it("has a level for every chat access, and a default among them", () => {
    expect(cfg.access.levels.map((l) => l.value)).toEqual(CHAT_ACCESS);
    for (const l of cfg.access.levels) {
      expect(l.label).toBeTruthy();
      expect(l.description).toBeTruthy();
    }
    expect(CHAT_ACCESS).toContain(cfg.access.default);
  });

  it("covers every task state, run status and trigger", () => {
    expect(Object.keys(cfg.taskStates).sort()).toEqual([...TASK_STATES].sort());
    expect(Object.keys(cfg.runStatuses).sort()).toEqual(
      [...RUN_STATUSES].sort()
    );
    expect(Object.keys(cfg.runTriggers).sort()).toEqual(
      [...RUN_TRIGGERS].sort()
    );
  });
});
