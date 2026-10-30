import {
  LEVELS,
  type GuestAction,
  type LevelOption,
  type LiveLevel,
} from "./types";
import type { Guest, Runtime } from "./runtime";

const ORDER: LiveLevel[] = ["watch", "suggest", "drive"];

/** What the invite dialog and the Live popover offer, with why one is off. */
export function levelOptions(): LevelOption[] {
  return ORDER.map((value) => ({
    value,
    ...LEVELS[value],
    ...(value === "drive"
      ? { enabled: false, reason: "Coming soon" }
      : { enabled: true }),
  }));
}

export function guestActions(_rt: Runtime, g: Guest): GuestAction[] {
  return g.status === "pending"
    ? [
        { kind: "admit", label: "Admit" },
        { kind: "deny", label: "Deny" },
      ]
    : [{ kind: "kick", label: "Kick" }];
}
