import { describe, expect, it } from "vitest";
import type { DigestSignals, Recommendation } from "@/lib/analyst/types";
import { cardView } from "./cardState";

const signals = (over: Partial<DigestSignals> = {}): DigestSignals => ({
  turns: 1,
  toolCalls: 3,
  failedTools: 0,
  checks: [],
  filesChanged: [],
  durationMs: 1000,
  costUsd: 0,
  interrupted: false,
  errors: 0,
  noToolTurns: 0,
  readWeb: false,
  ...over,
});

const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  id: "r1",
  linkId: "l1",
  analystItemId: "a1",
  coderThrough: "t1",
  verdict: "continue",
  summary: "Did the thing",
  issues: [],
  signals: signals(),
  prompt: "Run the tests",
  state: "open",
  error: null,
  sentText: null,
  sentItemId: null,
  edited: false,
  createdAt: 1,
  decidedAt: null,
  ...over,
});

describe("cardView", () => {
  it("offers Send, Edit and Dismiss on an open card with a prompt", () => {
    const v = cardView(rec(), "continue", "t1");
    expect(v).toMatchObject({
      label: "Next prompt",
      canSend: true,
      canWrite: true,
      canDismiss: true,
      canAskAgain: false,
      notes: [],
    });
  });

  it("is read-only without a stored card", () => {
    const v = cardView(null, "continue", "t1");
    expect(v.canSend || v.canWrite || v.canDismiss).toBe(false);
  });

  it("has no Send on a blocked or needs-you card, but lets the user write one", () => {
    for (const verdict of ["blocked", "needs_you"] as const) {
      const v = cardView(rec({ verdict }), verdict, "t1");
      expect(v.canSend).toBe(false);
      expect(v.canWrite).toBe(true);
    }
  });

  it("warns when the coding agent has moved on", () => {
    const v = cardView(rec(), "continue", "t2");
    expect(v.canSend).toBe(true);
    expect(v.notes).toContain(
      "The coding agent has moved on since this review"
    );
  });

  it("flags a turn with no tool calls and web reads", () => {
    const v = cardView(
      rec({ signals: signals({ noToolTurns: 1, readWeb: true }) }),
      "continue",
      "t1"
    );
    expect(v.notes).toEqual([
      "The coding agent's turn ended without a single tool call",
      "It read web content: check the prompt before sending",
    ]);
  });

  it("offers Ask again on an invalid card, with its error", () => {
    const v = cardView(
      rec({ state: "invalid", error: "No block", verdict: null }),
      null,
      "t1"
    );
    expect(v).toMatchObject({
      canAskAgain: true,
      canSend: false,
      notes: ["No block"],
    });
  });

  it("is settled once sent, dismissed or superseded", () => {
    for (const state of ["sent", "dismissed", "superseded"] as const) {
      const v = cardView(rec({ state }), "continue", "t2");
      expect(v.canSend || v.canWrite || v.canDismiss).toBe(false);
      expect(v.notes).toEqual([]);
    }
    expect(
      cardView(rec({ state: "sent", edited: true }), "continue", "t1").label
    ).toBe("Sent, edited");
  });
});
