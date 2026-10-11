"use client";

import { useSchedulesQuery } from "@/data/schedules";
import { schedulesBadge } from "@/lib/schedules/badge";
import { formatRunTime } from "@/lib/schedules/cron";
import { relativeTime } from "@/lib/schedules/when";

// Schedules at a glance for the header's menu: how many failed their last
// run (a red badge) and when the next one runs (a line under the item).
export function useSchedulesGlance(workspaceId: string | null) {
  const { data: schedules = [] } = useSchedulesQuery(workspaceId);
  const { next, failed, upcoming, nextUpcoming } = schedulesBadge(schedules);
  const failedText = failed
    ? `${failed} schedule${failed === 1 ? "" : "s"} failed last run`
    : null;
  const nextText = next
    ? `Next: ${next.name}, ${formatRunTime(next.at, next.timezone)}`
    : schedules.length
      ? "Nothing scheduled to run"
      : "No schedules yet";
  const upcomingText = upcoming
    ? `${upcoming} upcoming${nextUpcoming ? ` · next ${relativeTime(nextUpcoming.at)}` : ""}`
    : null;
  return { failed, failedText, nextText, upcoming, upcomingText };
}
