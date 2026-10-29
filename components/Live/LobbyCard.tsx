"use client";

import { Check, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LiveView } from "@/data/live";

type Guest = LiveView["guests"][number];

// Someone opened the link and is waiting. The name is whatever they typed.
export function LobbyCard({
  guest,
  busy,
  onAdmit,
  onDeny,
}: {
  guest: Guest;
  busy: boolean;
  onAdmit: () => void;
  onDeny: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={`${guest.name} wants to join`}
      className="bg-muted/60 flex flex-col gap-2 rounded-xl p-3 shadow-sm sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <UserRound
          className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0"
          aria-hidden
        />
        <div className="min-w-0 text-sm">
          <p className="[overflow-wrap:anywhere]">
            <span className="font-medium">{guest.name}</span> wants to join
          </p>
          <p className="text-muted-foreground text-xs">
            {guest.duplicateName
              ? "Another guest here has the same name. Names aren't verified."
              : "Names aren't verified."}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          className="min-h-11 flex-1 sm:flex-none"
          disabled={busy}
          onClick={onAdmit}
        >
          <Check className="h-4 w-4" />
          Admit
        </Button>
        <Button
          variant="outline"
          className="min-h-11 flex-1 sm:flex-none"
          disabled={busy}
          onClick={onDeny}
        >
          <X className="h-4 w-4" />
          Deny
        </Button>
      </div>
    </div>
  );
}
