import { wakeLabel } from "./snooze";

// What a paused row says under its title.
export function pauseSubtitle(
  paused: {
    state: "pausing" | "paused" | "resuming";
    until: number | null;
    // Why a requested resume hasn't happened yet.
    note?: string | null;
  },
  now: number = Date.now(),
  timeZone?: string
): string {
  if (paused.note && paused.state !== "pausing")
    return paused.note[0].toUpperCase() + paused.note.slice(1);
  if (paused.state === "pausing") return "Pausing · finishing its step";
  if (paused.state === "resuming") return "Resuming · waiting for a slot";
  if (paused.until === null) return "Paused until you resume";
  return `Paused · resumes ${wakeLabel(paused.until, now, timeZone)}`;
}
