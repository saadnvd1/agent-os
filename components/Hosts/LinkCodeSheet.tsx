"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCancelLink, useOutgoingLink } from "@/data/peers";
import { showCode } from "@/lib/peer/code";
import { SHEET } from "./sheet";

const ENDED: Record<string, string> = {
  declined: "It was declined there, or the code was typed wrong 3 times.",
  expired: "The request expired before the code was typed.",
  failed: "It was accepted there, but couldn't be saved here.",
};

/** On the machine that asks: the code to type on the other one. */
export function LinkCodeSheet({
  linkId,
  onClose,
  onRetry,
}: {
  linkId: string | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { data: link, error } = useOutgoingLink(linkId);
  const cancel = useCancelLink();
  const close = () => {
    if (link?.state === "pending" && linkId) cancel.mutate(linkId);
    onClose();
  };
  const name = link?.name ?? "the other machine";

  return (
    <Dialog open={!!linkId} onOpenChange={(o) => !o && close()}>
      <DialogContent className={SHEET}>
        <DialogHeader>
          <DialogTitle>Link {name}</DialogTitle>
          <DialogDescription>
            Open AgentOS on {name} and type this code there. Its banner, the
            Machines screen, or{" "}
            <code className="font-mono">agent-os link accept</code> in its
            terminal all take it.
          </DialogDescription>
        </DialogHeader>
        {link && (
          <p
            className="text-center font-mono text-4xl font-semibold tracking-[0.2em] tabular-nums sm:text-5xl"
            aria-label={`Code ${link.code.split("").join(" ")}`}
            data-testid="link-code"
          >
            {showCode(link.code)}
          </p>
        )}
        <div className="flex min-h-11 items-center justify-center gap-2 text-sm">
          {error ? (
            <span className="text-destructive">{error.message}</span>
          ) : !link || link.state === "pending" ? (
            <>
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
              <span className="text-muted-foreground">
                Waiting for the code on {name}…
              </span>
            </>
          ) : link.state === "accepted" ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Linked. Tasks can run on {name} now.</span>
            </>
          ) : (
            <>
              <XCircle className="text-destructive h-4 w-4" />
              <span className="text-muted-foreground">
                {ENDED[link.state] ?? link.error}
              </span>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {link && link.state !== "pending" && link.state !== "accepted" && (
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={onRetry}
            >
              Try again
            </Button>
          )}
          <Button
            variant={link?.state === "accepted" ? "default" : "ghost"}
            className="min-h-11 sm:min-h-9"
            onClick={close}
          >
            {link?.state === "pending" ? "Cancel" : "Done"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
