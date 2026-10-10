"use client";

import { useSchedulesQuery } from "@/data/schedules";
import { schedulesBadge } from "@/lib/schedules/badge";
import { formatRunTime } from "@/lib/schedules/cron";

// Schedules at a glance for the header's menu: how many failed their last
// run (a red badge) and when the next one runs (a line under the item).
export function useSchedulesGlance(workspaceId: string | null) {
  const { data: schedules = [] } = useSchedulesQuery(workspaceId);
  const { next, failed } = schedulesBadge(schedules);
  const failedText = failed
    ? `${failed} schedule${failed === 1 ? "" : "s"} failed last run`
    : null;
  const nextText = next
    ? `Next: ${next.name}, ${formatRunTime(next.at, next.timezone)}`
    : schedules.length
      ? "Nothing scheduled to run"
      : "No schedules yet";
  return { failed, failedText, nextText };
}
