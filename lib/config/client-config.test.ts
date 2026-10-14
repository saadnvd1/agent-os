import { readFileSync } from "node:fs";
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

  it("carries the phone limits and kill switches, additively", () => {
    expect(cfg.v).toBe(1);
    expect(cfg.features).toEqual({
      shakeToReport: true,
      shareIntake: true,
      voice: true,
    });
    expect(cfg.intake).toEqual({
      maxBytes: 25_000_000,
      maxFiles: 8,
      maxInlineImages: 2,
      maxNoteChars: 280,
      screenshotMaxEdge: 1600,
      logSeconds: 60,
      logMaxLines: 200,
    });
    expect(cfg.attachments).toEqual({ max: 8 });
    expect(cfg.voice).toEqual({
      maxPhrases: 100,
      holdMinMs: 250,
      cancelSlidePx: 80,
      speakMaxChars: 300,
    });
  });

  it("keeps the synced types file free of imports", () => {
    const src = readFileSync(
      new URL("./client-config-types.ts", import.meta.url),
      "utf8"
    );
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
