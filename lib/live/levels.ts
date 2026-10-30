import type { Session } from "../db";
import {
  LEVELS,
  type DriverState,
  type GuestAction,
  type LevelOption,
  type LiveLevel,
  type LiveView,
} from "./types";
import { driveRefusal, driverState } from "./drive";
import type { Guest, Runtime } from "./runtime";

const ORDER: LiveLevel[] = ["watch", "suggest", "drive"];

/** What the invite dialog and the Live popover offer, with why one is off. */
export function levelOptions(session: Session | null): LevelOption[] {
  const why = session ? driveRefusal(session) : "Task sessions only";
  return ORDER.map((value) => ({
    value,
    ...LEVELS[value],
    ...(value === "drive" && why
      ? { enabled: false, reason: why }
      : { enabled: true }),
  }));
}

export function guestActions(
  rt: Runtime,
  g: Guest,
  canDrive: boolean
): GuestAction[] {
  const drive = rt.share.level === "drive" && canDrive;
  if (g.status === "pending")
    return drive && !rt.drive.wheel
      ? [
          { kind: "admit", label: "Let in" },
          { kind: "admit_drive", label: "Let in to drive" },
          { kind: "deny", label: "Deny" },
        ]
      : [
          { kind: "admit", label: drive ? "Let in" : "Admit" },
          { kind: "deny", label: "Deny" },
        ];
  const kick: GuestAction = { kind: "kick", label: "Kick" };
  if (rt.share.level !== "drive") return [kick];
  if (rt.drive.wheel?.guestId === g.id)
    return [{ kind: "take_back", label: "Take back" }, kick];
  return drive
    ? [{ kind: "give_wheel", label: "Give the wheel" }, kick]
    : [kick];
}

const DRIVING: Record<DriverState, string> = {
  idle: "is driving",
  queued: "is driving · prompt queued",
  working: "is driving · working",
  waiting_on_host: "is driving · waiting on you",
};

/** The guest holding the wheel and the banner the host sees above the composer. */
export function driveView(rt: Runtime): Pick<LiveView, "driver" | "banner"> {
  const w = rt.drive.wheel;
  const g = w && rt.guests.get(w.guestId);
  if (rt.share.level !== "drive" || !w || !g)
    return { driver: null, banner: null };
  const state = driverState(rt);
  return {
    driver: { guestId: g.id, name: g.name, state },
    banner: {
      text: `${g.name} ${DRIVING[state]}`,
      action: { kind: "take_back", label: "Take back" },
    },
  };
}
