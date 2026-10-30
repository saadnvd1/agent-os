"use client";

import { Hand, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LiveView } from "@/data/live";

// A guest holds the wheel: what they're doing, and the host's way back.
export function DriveBanner({
  banner,
  busy,
  onTakeBack,
}: {
  banner: NonNullable<LiveView["banner"]>;
  busy: boolean;
  onTakeBack: () => void;
}) {
  return (
    <div
      role="status"
      className="bg-primary/[0.06] flex items-center gap-2 rounded-xl py-1 pr-1 pl-3 shadow-sm"
    >
      <Users className="text-primary h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="leading-snug font-medium">{banner.text}</p>
        <p className="text-muted-foreground truncate text-xs max-sm:hidden">
          Every edit, command and outside read asks you first.
        </p>
      </div>
      {banner.action && (
        <Button
          variant="outline"
          className="min-h-11 shrink-0"
          disabled={busy}
          onClick={onTakeBack}
        >
          <Hand className="h-4 w-4" aria-hidden />
          {banner.action.label}
        </Button>
      )}
    </div>
  );
}
