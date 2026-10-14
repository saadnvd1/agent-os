import type { StackItemView, StackStatus } from "@/lib/stacks/types";

export type ChipStatus = StackItemView["status"] | StackStatus;
export type ChipIcon = "spinner" | "pr" | null;

// Colour means "look at this": amber needs you, red failed, green final.
// Everything still moving on its own is neutral, and an icon carries the meaning.
const amber = "bg-amber-500/15 text-amber-700 dark:text-amber-300";
const green = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
const muted = "bg-foreground/[0.06] text-muted-foreground";
const red = "bg-destructive/15 text-destructive";

interface Chip {
  label: string;
  tone: string;
  icon: ChipIcon;
}

export const CHIP: Record<ChipStatus, Chip> = {
  planned: { label: "Planned", tone: muted, icon: null },
  held: { label: "Held", tone: amber, icon: null },
  starting: { label: "Starting", tone: muted, icon: "spinner" },
  running: { label: "Working", tone: muted, icon: "spinner" },
  pr: { label: "PR open", tone: muted, icon: "pr" },
  merged: { label: "Merged", tone: green, icon: null },
  failed: { label: "Failed", tone: red, icon: null },
  dropped: { label: "Dropped", tone: muted, icon: null },
  done: { label: "Done", tone: green, icon: null },
  excluded: { label: "Left out", tone: muted, icon: null },
  paused: { label: "Paused", tone: amber, icon: null },
  landing: { label: "Landing", tone: muted, icon: "spinner" },
  landed: { label: "Landed", tone: green, icon: null },
};

export function chipFor(
  status: ChipStatus,
  opts: { attention?: boolean; stack?: boolean } = {}
): Chip {
  if (opts.attention) return { label: "Needs you", tone: amber, icon: null };
  // A whole stack: "running" reads as Running, not Working.
  if (opts.stack && status === "running")
    return { label: "Running", tone: muted, icon: "spinner" };
  return CHIP[status];
}
