import type { StopReason } from "@/lib/loops/types";

export const STOP_LABEL: Record<StopReason, string> = {
  stopped: "Stopped by you",
  blocked: "Needs you",
  done: "All criteria met",
  repeat: "The same failure kept coming back",
  no_progress: "No progress",
  "limit:cycles": "Reached its cycle limit",
  "limit:cost": "Reached its cost cap",
  "limit:time": "Reached its time limit",
};

export const minutesText = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
