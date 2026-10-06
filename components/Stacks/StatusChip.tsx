import type { StackItemView, StackStatus } from "@/lib/stacks/types";
import { cn } from "@/lib/utils";

type Status = StackItemView["status"] | StackStatus;

const amber = "bg-amber-500/15 text-amber-700 dark:text-amber-300";
const green = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
const muted = "bg-foreground/[0.06] text-muted-foreground";
const purple = "bg-primary/15 text-primary";
const red = "bg-destructive/15 text-destructive";

const CHIP: Record<Status, { label: string; tone: string }> = {
  planned: { label: "Planned", tone: muted },
  held: { label: "Held", tone: amber },
  running: { label: "Working", tone: purple },
  pr: { label: "PR open", tone: purple },
  merged: { label: "Merged", tone: green },
  failed: { label: "Failed", tone: red },
  dropped: { label: "Dropped", tone: muted },
  done: { label: "Done", tone: green },
  excluded: { label: "Left out", tone: muted },
  paused: { label: "Paused", tone: amber },
  landing: { label: "Landing", tone: purple },
  landed: { label: "Landed", tone: green },
};

export function StatusChip({
  status,
  attention,
}: {
  status: Status;
  attention?: boolean;
}) {
  const chip = attention ? { label: "Needs you", tone: amber } : CHIP[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        chip.tone
      )}
    >
      {chip.label}
    </span>
  );
}
