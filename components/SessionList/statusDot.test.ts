import { describe, expect, it } from "vitest";
import type { LoadView } from "@/lib/load/monitor";
import { statusDot } from "./statusDot";

const load = (level: LoadView["level"]): LoadView => ({
  level,
  load1: 4.2,
  cores: 10,
  memUsedPct: 40,
  pressure: "normal",
  top: [],
  unattributed: [],
  sessions: {},
});
const none = { open: 0, needsYou: 0 };

describe("statusDot", () => {
  it("is green and opens the load popover when all is well", () => {
    const d = statusDot(load("green"), none)!;
    expect(d).toMatchObject({
      level: "green",
      label: "Load normal",
      opensHealth: false,
      healthLine: null,
    });
  });
  it("follows load alone", () => {
    expect(statusDot(load("amber"), none)!.level).toBe("amber");
    expect(statusDot(load("red"), none)!.level).toBe("red");
  });
  it("goes amber for an open health issue and opens Health", () => {
    const d = statusDot(load("green"), { open: 1, needsYou: 0 })!;
    expect(d.level).toBe("amber");
    expect(d.label).toBe("Load normal · 1 health issue open");
    expect(d.title).toContain("Load 4.2 on 10 cores");
    expect(d.opensHealth).toBe(true);
  });
  it("goes red when a health issue needs Saad", () => {
    const d = statusDot(load("green"), { open: 2, needsYou: 2 })!;
    expect(d.level).toBe("red");
    expect(d.label).toBe("Load normal · 2 health issues need you");
    expect(statusDot(load("amber"), { open: 1, needsYou: 1 })!.level).toBe(
      "red"
    );
  });
  it("takes the worse of the two", () => {
    expect(statusDot(load("red"), { open: 1, needsYou: 0 })!.level).toBe("red");
  });
  it("shows health alone before load arrives, nothing with neither", () => {
    expect(statusDot(null, { open: 2, needsYou: 0 })!.label).toBe(
      "2 health issues open"
    );
    expect(statusDot(null, none)).toBeNull();
    expect(statusDot(null, undefined)).toBeNull();
  });
});
