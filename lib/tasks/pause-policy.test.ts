import { describe, expect, it } from "vitest";
import {
  continuePrompt,
  durationText,
  mayResume,
  pauseRefusal,
  resumeRefusal,
  type PauseFacts,
} from "./pause-policy";

const facts = (over: Partial<PauseFacts> = {}): PauseFacts => ({
  isTask: true,
  isOrchestrator: false,
  isQuickChange: false,
  isRemote: false,
  taskStatus: "running",
  pauseState: null,
  held: false,
  merging: false,
  settingUp: false,
  chatWaiting: false,
  terminalWaiting: false,
  openAsk: false,
  openQuestion: false,
  escalated: false,
  planAwaiting: false,
  resumable: true,
  ...over,
});

describe("pauseRefusal", () => {
  it("lets a running task pause", () => {
    expect(pauseRefusal(facts())).toBeNull();
    expect(pauseRefusal(facts({ isTask: false, taskStatus: null }))).toBeNull();
  });

  it.each([
    ["an orchestrator", { isOrchestrator: true }, /orchestrator/i],
    ["a quick change", { isQuickChange: true }, /quick change/],
    ["a remote session", { isRemote: true }, /another machine/],
    ["an agent it can't restart", { resumable: false }, /started again/],
    ["a task that isn't running", { taskStatus: "merged" }, /merged/],
    ["one already paused", { pauseState: "paused" }, /already paused/],
    ["one that is merging", { merging: true }, /merging/],
    ["one that is moving or landing", { held: true }, /moving/],
    ["one still setting up", { settingUp: true }, /setting up/],
    ["a chat waiting on you", { chatWaiting: true }, /waiting on you/],
    ["a terminal waiting on you", { terminalWaiting: true }, /waiting on you/],
    ["an open ask", { openAsk: true }, /waiting on you/],
    ["an open question", { openQuestion: true }, /waiting on you/],
    ["a holding escalation", { escalated: true }, /waiting on you/],
    ["a plan awaiting approval", { planAwaiting: true }, /waiting on you/],
  ])("refuses %s", (_n, over, text) => {
    expect(pauseRefusal(facts(over))).toMatch(text);
  });
});

describe("who may resume", () => {
  it("a person outranks the orchestrator, which outranks the scheduler", () => {
    expect(mayResume("person", "person")).toBe(true);
    expect(mayResume("person", "orchestrator")).toBe(true);
    expect(mayResume("orchestrator", "scheduler")).toBe(true);
    expect(mayResume("orchestrator", "person")).toBe(false);
    expect(mayResume("scheduler", "orchestrator")).toBe(false);
  });

  it("says who holds the pause", () => {
    expect(resumeRefusal("orchestrator", "person", "9 AM")).toMatch(
      /a person until 9 AM/
    );
    expect(resumeRefusal("person", "person", null)).toBeNull();
  });
});

describe("the resume prompt", () => {
  it("folds every held message into one prompt", () => {
    const text = continuePrompt({
      pausedAt: "9:00 AM",
      by: "person",
      duration: "for 2 hours",
      interrupted: false,
      held: [
        { from: "CI", text: "build failed" },
        { from: "the orchestrator", text: "rebase please" },
      ],
    });
    expect(text).toContain("paused at 9:00 AM (by the user, for 2 hours)");
    expect(text).toContain("2 messages arrived");
    expect(text).toContain("1. From CI: build failed");
    expect(text).toContain("2. From the orchestrator: rebase please");
    expect(text).not.toContain("interrupted");
  });

  it("says when the last step was cut short, and says nothing held when none was", () => {
    const text = continuePrompt({
      pausedAt: "1 PM",
      by: "scheduler",
      duration: "until resumed",
      interrupted: true,
      held: [],
    });
    expect(text).toContain("interrupted");
    expect(text).toContain("machine was loaded");
    expect(text).not.toContain("arrived");
  });

  it("words durations", () => {
    const t = Date.parse("2026-10-14T09:00:00Z");
    expect(durationText(t, null)).toBe("until resumed");
    expect(durationText(t, t + 60 * 60_000)).toBe("for 60 minutes");
    expect(durationText(t, t + 2 * 3_600_000)).toBe("for 2 hours");
    expect(durationText(t, t + 72 * 3_600_000)).toBe("for 3 days");
  });
});
