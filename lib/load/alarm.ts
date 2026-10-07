// When to raise the alarm: once the load has been red for a while, then not
// again until it has stayed green for a good stretch. Amber neither raises
// nor re-arms it.
import type { LoadLevel } from "./level";

export const RED_FOR_MS = 2 * 60_000;
export const QUIET_GREEN_MS = 10 * 60_000;

export class LoadAlarm {
  private redSince: number | null = null;
  private greenSince: number | null = null;
  private armed = true;

  constructor(
    private redForMs = RED_FOR_MS,
    private quietGreenMs = QUIET_GREEN_MS
  ) {}

  // True exactly when an alert should go out now.
  feed(level: LoadLevel, now: number): boolean {
    if (level !== "red") this.redSince = null;
    if (level !== "green") this.greenSince = null;
    if (level === "green") {
      this.greenSince ??= now;
      if (!this.armed && now - this.greenSince >= this.quietGreenMs)
        this.armed = true;
      return false;
    }
    if (level === "amber") return false;
    this.redSince ??= now;
    if (this.armed && now - this.redSince >= this.redForMs) {
      this.armed = false;
      return true;
    }
    return false;
  }
}
