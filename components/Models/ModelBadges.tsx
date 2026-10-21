import type { Availability } from "@/lib/models/availability";
import type { Locality } from "@/lib/models/locality";
import { cn } from "@/lib/utils";

// Whether a model runs on this machine's own networks or in the cloud.
export function LocalityBadge({ locality }: { locality: Locality }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium",
        locality === "local"
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-muted text-muted-foreground ring-border ring-1 ring-inset"
      )}
    >
      {locality === "local" ? "Local" : "Cloud"}
    </span>
  );
}

const DOT = {
  up: "bg-emerald-500",
  down: "bg-destructive",
  unknown: "bg-muted-foreground/50",
} as const;

const TITLE = {
  up: "Answering",
  down: "Not answering",
  unknown: "Not checked",
} as const;

// The last availability check: green answering, red not, grey not checked.
export function AvailabilityDot({
  availability,
}: {
  availability: Pick<Availability, "state"> | undefined;
}) {
  const state = availability?.state ?? "unknown";
  return (
    <span
      role="img"
      aria-label={TITLE[state]}
      title={TITLE[state]}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[state])}
    />
  );
}
