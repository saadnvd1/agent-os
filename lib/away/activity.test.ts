import { describe, expect, it } from "vitest";
import { db } from "../db";
import {
  awayWindowMinutes,
  lastChatTurn,
  setAwayWindowMinutes,
  WINDOW_KEY,
} from "./activity";
import { DEFAULT_WINDOW_MINUTES, parseWindow } from "./window-limits";

const event = { kind: "event" as const, label: "AgentOS" };
const away = { ...event, away: true as const };

describe("a chat's last real turn", () => {
  it("is the newest reply or message Saad typed", () => {
    expect(
      lastChatTurn([
        { kind: "assistant", createdAt: 30 },
        { kind: "tool", createdAt: 20 },
        { kind: "user", createdAt: 10 },
      ])
    ).toBe(30);
  });

  it("doesn't count a turn Away mode started, or the message itself", () => {
    expect(
      lastChatTurn([
        { kind: "turn_end", createdAt: 90 },
        { kind: "assistant", createdAt: 80 },
        { kind: "user", createdAt: 70, origin: away },
        { kind: "assistant", createdAt: 20 },
        { kind: "user", createdAt: 10 },
      ])
    ).toBe(20);
    expect(lastChatTurn([{ kind: "user", createdAt: 70, origin: away }])).toBe(
      0
    );
  });

  it("counts a turn an event or a peer started from its reply, not the message", () => {
    expect(
      lastChatTurn([
        { kind: "assistant", createdAt: 50 },
        { kind: "user", createdAt: 40, origin: event },
      ])
    ).toBe(50);
    // An event no turn answered yet isn't activity.
    expect(
      lastChatTurn([
        { kind: "user", createdAt: 40, origin: event },
        { kind: "assistant", createdAt: 20 },
      ])
    ).toBe(20);
  });

  it("ignores notes, errors and compactions", () => {
    expect(
      lastChatTurn([
        { kind: "compacted", createdAt: 99 },
        { kind: "error", createdAt: 98 },
        { kind: "assistant", createdAt: 5 },
      ])
    ).toBe(5);
  });
});

describe("the away window setting", () => {
  it("defaults to an hour, and takes whole minutes in range", () => {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(WINDOW_KEY);
    expect(awayWindowMinutes()).toBe(DEFAULT_WINDOW_MINUTES);
    expect(setAwayWindowMinutes(90)).toBe(90);
    expect(awayWindowMinutes()).toBe(90);
    expect(() => setAwayWindowMinutes(5)).toThrow(/minutes/);
    expect(() => setAwayWindowMinutes(30.5)).toThrow(/minutes/);
    expect(() => setAwayWindowMinutes("60")).toThrow(/minutes/);
    expect(awayWindowMinutes()).toBe(90);
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(WINDOW_KEY);
  });

  it("reads the form's text the same way", () => {
    expect(parseWindow(" 45 ")).toBe(45);
    expect(parseWindow("")).toBeNull();
    expect(parseWindow("9")).toBeNull();
    expect(parseWindow("2000")).toBeNull();
  });
});
