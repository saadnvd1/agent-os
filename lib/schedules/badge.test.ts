import { describe, expect, it } from "vitest";
import type { ScheduleView } from "./index";
import { schedulesBadge } from "./badge";

const s = (over: Partial<ScheduleView>): ScheduleView =>
  ({
    name: "s",
    enabled: true,
    paused: false,
    nextRunAt: null,
    lastRun: null,
    timezone: "America/Chicago",
    ...over,
  }) as ScheduleView;

describe("schedulesBadge", () => {
  it("names the soonest enabled run and counts failed last runs", () => {
    const badge = schedulesBadge([
      s({ name: "later", nextRunAt: 300 }),
      s({ name: "soon", nextRunAt: 100 }),
      s({ name: "off", nextRunAt: 50, enabled: false }),
      s({ name: "paused", nextRunAt: 10, paused: true }),
      s({
        name: "broke",
        lastRun: { outcome: "failed" } as ScheduleView["lastRun"],
      }),
    ]);
    expect(badge.next).toMatchObject({ name: "soon", at: 100 });
    expect(badge.failed).toBe(1);
  });

  it("is quiet with no schedules", () => {
    expect(schedulesBadge([])).toEqual({ next: null, failed: 0 });
  });
});
