import type { ScheduleView } from "./index";

export interface SchedulesBadge {
  // The soonest enabled schedule's next run.
  next: { name: string; at: number; timezone: string } | null;
  // How many schedules' last run failed.
  failed: number;
  // Enabled one-offs still to run, soonest first.
  upcoming: number;
  nextUpcoming: { name: string; at: number; timezone: string } | null;
}

// What the sidebar's Schedules clock says at a glance.
export function schedulesBadge(schedules: ScheduleView[]): SchedulesBadge {
  let next: SchedulesBadge["next"] = null;
  let failed = 0;
  let upcoming = 0;
  let nextUpcoming: SchedulesBadge["nextUpcoming"] = null;
  for (const s of schedules) {
    if (s.lastRun?.outcome === "failed") failed++;
    if (s.oneOff && s.enabled && !s.done_at) {
      upcoming++;
      if (s.nextRunAt && (!nextUpcoming || s.nextRunAt < nextUpcoming.at))
        nextUpcoming = { name: s.name, at: s.nextRunAt, timezone: s.timezone };
    }
    if (
      s.enabled &&
      !s.paused &&
      s.nextRunAt &&
      (!next || s.nextRunAt < next.at)
    )
      next = { name: s.name, at: s.nextRunAt, timezone: s.timezone };
  }
  return { next, failed, upcoming, nextUpcoming };
}
