import { describe, expect, it } from "vitest";
import { LoadAlarm } from "./alarm";

const MIN = 60_000;

describe("the load alarm", () => {
  it("fires once red has lasted two minutes, and only once", () => {
    const alarm = new LoadAlarm();
    expect(alarm.feed("red", 0)).toBe(false);
    expect(alarm.feed("red", 1.9 * MIN)).toBe(false);
    expect(alarm.feed("red", 2 * MIN)).toBe(true);
    expect(alarm.feed("red", 30 * MIN)).toBe(false);
  });

  it("restarts the red clock when the load drops out of red", () => {
    const alarm = new LoadAlarm();
    alarm.feed("red", 0);
    alarm.feed("amber", 1.5 * MIN);
    expect(alarm.feed("red", 2 * MIN)).toBe(false);
    expect(alarm.feed("red", 4 * MIN)).toBe(true);
  });

  it("starts disarmed after a restart that followed an alert", () => {
    const alarm = new LoadAlarm(false);
    alarm.feed("red", 0);
    expect(alarm.feed("red", 5 * MIN)).toBe(false);
    alarm.feed("green", 6 * MIN);
    alarm.feed("green", 16 * MIN);
    expect(alarm.isArmed).toBe(true);
  });

  it("stays quiet until ten unbroken green minutes", () => {
    const alarm = new LoadAlarm();
    alarm.feed("red", 0);
    expect(alarm.feed("red", 2 * MIN)).toBe(true);
    alarm.feed("green", 3 * MIN);
    // Amber breaks the green stretch.
    alarm.feed("amber", 12 * MIN);
    alarm.feed("red", 13 * MIN);
    expect(alarm.feed("red", 16 * MIN)).toBe(false);
    alarm.feed("green", 17 * MIN);
    alarm.feed("green", 27 * MIN);
    alarm.feed("red", 28 * MIN);
    expect(alarm.feed("red", 30 * MIN)).toBe(true);
  });
});

describe("the alarm across a restart", () => {
  it("stays disarmed after an alert until the load has been green", async () => {
    const { feedAlarm, loadAlarmFromDb } = await import("./monitor");
    const { db } = await import("../db");
    const saved = () =>
      (
        db
          .prepare(`SELECT value FROM settings WHERE key = 'load.alarm_armed'`)
          .get() as { value: string } | undefined
      )?.value;
    loadAlarmFromDb();
    feedAlarm("red", 0);
    expect(feedAlarm("red", 2 * MIN)).toBe(true);
    expect(saved()).toBe("0");
    // A restart during the same red stretch.
    loadAlarmFromDb();
    feedAlarm("red", 3 * MIN);
    expect(feedAlarm("red", 6 * MIN)).toBe(false);
    feedAlarm("green", 7 * MIN);
    feedAlarm("green", 17 * MIN);
    expect(saved()).toBe("1");
    loadAlarmFromDb();
    feedAlarm("red", 18 * MIN);
    expect(feedAlarm("red", 20 * MIN)).toBe(true);
  });
});
