"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AGENT_ROLE_DEFS, isAgentRole } from "@/lib/models/agent-roles";
import type { ModelUnavailableError } from "@/data/sessions/queries";

// A session in a role couldn't start: its model's server isn't answering.
// A local model never turns into a cloud one on its own: starting on the
// role's fallback is a choice made here.
export function ModelUnavailableDialog({
  error,
  busy,
  onRetry,
  onFallback,
  onPick,
  onClose,
}: {
  error: ModelUnavailableError | null;
  busy: boolean;
  onRetry: () => void;
  onFallback: () => void;
  onPick: () => void;
  onClose: () => void;
}) {
  const role =
    error && isAgentRole(error.role)
      ? AGENT_ROLE_DEFS[error.role].label
      : "role";
  const name = (ref: string) => ref.split("/").slice(1).join("/");
  return (
    <Dialog open={!!error} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Can&apos;t start the {role}</DialogTitle>
          <DialogDescription>
            {error ? `${name(error.ref)}'s server isn't answering.` : ""}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="bg-muted/60 text-muted-foreground rounded-lg px-3 py-2 font-mono text-xs break-words">
            {error.message}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button className="h-11" disabled={busy} onClick={onRetry}>
            Retry
          </Button>
          {error?.fallback && (
            <Button
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={onFallback}
            >
              Start on {name(error.fallback)}
            </Button>
          )}
          <Button variant="outline" className="h-11" onClick={onPick}>
            Pick another model
          </Button>
        </div>
        {error?.fallback && (
          <p className="text-muted-foreground text-xs">
            Starting on the fallback sends your code to wherever that model
            runs.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
