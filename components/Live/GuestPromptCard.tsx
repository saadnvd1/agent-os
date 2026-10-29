"use client";

import { Pencil, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LiveView } from "@/data/live";

type Suggestion = LiveView["suggestions"][number];

// A guest's suggested prompt, as plain text. Nothing is sent until Send.
export function GuestPromptCard({
  suggestion,
  busy,
  onSend,
  onEdit,
  onDismiss,
}: {
  suggestion: Suggestion;
  busy: boolean;
  onSend: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={`Suggestion from ${suggestion.guestName}`}
      className="bg-muted/60 flex flex-col gap-2 rounded-xl p-3 shadow-sm"
    >
      <p className="text-muted-foreground text-xs">
        Suggestion from{" "}
        <span className="text-foreground font-medium">
          {suggestion.guestName}
        </span>
      </p>
      <p className="max-h-40 overflow-y-auto text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
        {suggestion.text}
      </p>
      <div className="flex gap-2">
        <Button className="min-h-11 flex-1" disabled={busy} onClick={onSend}>
          <Send className="h-4 w-4" />
          Send
        </Button>
        <Button
          variant="outline"
          className="min-h-11 flex-1"
          disabled={busy}
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
        <Button
          variant="outline"
          className="min-h-11 flex-1"
          disabled={busy}
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
