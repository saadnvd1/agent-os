"use client";

import { GitCompareArrows } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import type { Session } from "@/lib/db";
import { claimsUiActions } from "@/stores/claimsUi";

// "Overlaps: box" on a session row: amber when the overlap is strong, muted
// when weak. Tapping opens the claims sheet on that pair.
export function OverlapPill({
  overlap,
}: {
  overlap: NonNullable<Session["overlap"]>;
}) {
  const strong = overlap.strength === "strong";
  const files = overlap.shared
    ? ` · ${overlap.shared} shared file${overlap.shared === 1 ? "" : "s"}`
    : "";
  return (
    <StatusPill
      tone={strong ? "amber" : "muted"}
      data-tip={`${strong ? "Strong" : "Weak"} overlap with "${overlap.goal}" on ${overlap.machine}${files}. Tap to see both.`}
      aria-label={`Overlaps with ${overlap.machine}`}
      data-overlap={overlap.strength}
      onClick={() => claimsUiActions.open([overlap.mineId, overlap.claimId])}
    >
      <GitCompareArrows aria-hidden className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">Overlaps: {overlap.machine}</span>
    </StatusPill>
  );
}
