"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { StartWarning } from "@/lib/claims/startWarning";

// Above the composer when a person's task start overlaps claimed work. They
// choose: start anyway, queue it behind that work, or go back and edit.
export function StartClaimsNotice({
  warnings,
  busy,
  onStart,
  onDismiss,
}: {
  warnings: StartWarning[];
  busy: boolean;
  onStart: (after?: string) => void;
  onDismiss: () => void;
}) {
  const top = warnings[0];
  if (!top) return null;
  const files = top.shared.slice(0, 3).join(", ");
  return (
    <Notice
      tone="warning"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 md:min-h-8"
            disabled={busy}
            onClick={() => onStart()}
          >
            Start anyway
          </Button>
          <Button
            size="sm"
            className="min-h-11 md:min-h-8"
            disabled={busy}
            onClick={() => onStart(`claim:${top.claim.id}`)}
          >
            Start after it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 md:min-h-8"
            disabled={busy}
            onClick={onDismiss}
          >
            Edit
          </Button>
        </div>
      }
    >
      <p className="font-medium">
        {top.strength === "strong"
          ? "Someone is already on this"
          : "This may overlap"}
        {warnings.length > 1 ? ` (${warnings.length} claims)` : ""}
      </p>
      <p className="text-muted-foreground text-xs break-words">
        “{top.claim.goal}” on {top.claim.machine}
        {top.claim.branch ? ` (${top.claim.branch})` : ""}
        {files ? ` touches ${files}` : ""}
      </p>
    </Notice>
  );
}
