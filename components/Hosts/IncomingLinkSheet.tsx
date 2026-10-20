"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAnswerLink, usePendingLinks } from "@/data/peers";
import type { PendingView } from "@/lib/peer/pairing";
import { SHEET } from "./sheet";

/** On the machine being asked: type the code the other one shows. */
export function IncomingLinkSheet({
  request,
  onClose,
}: {
  request: PendingView | null;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const { accept, decline } = useAnswerLink();
  const digits = code.replace(/\D/g, "");
  const busy = accept.isPending || decline.isPending;
  const close = () => {
    setCode("");
    accept.reset();
    onClose();
  };
  const left = (accept.error as { attemptsLeft?: number } | null)?.attemptsLeft;

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && close()}>
      <DialogContent className={SHEET}>
        <DialogHeader>
          <DialogTitle>Link {request?.name}?</DialogTitle>
          <DialogDescription>
            {request?.name} asked to link with this machine. Type the code it
            shows to allow it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            Linked machines can start agents and run code on this machine. Only
            link one you own.
          </p>
        </div>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (request && digits.length === 6)
              accept.mutate(
                { id: request.id, code: digits },
                { onSuccess: close }
              );
          }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.slice(0, 7))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            aria-label="Code shown on the other machine"
            className="h-12 text-center font-mono text-2xl tracking-[0.3em]"
            autoFocus
          />
          {accept.error && (
            <p className="text-destructive text-sm">
              {accept.error.message}
              {left ? ` ${left} ${left === 1 ? "try" : "tries"} left.` : ""}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 sm:min-h-9"
              disabled={busy}
              onClick={() =>
                request && decline.mutate(request.id, { onSuccess: close })
              }
            >
              Decline
            </Button>
            <Button
              type="submit"
              className="min-h-11 sm:min-h-9"
              disabled={busy || digits.length !== 6 || left === 0}
            >
              Link
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A banner on every page while a machine is waiting for its code here. */
export function IncomingLinks() {
  const { data: requests = [] } = usePendingLinks();
  // Held while open, so a request voided by a wrong code still says why.
  const [open, setOpen] = useState<PendingView | null>(null);
  const first = requests[0];
  return (
    <>
      {first && !open && (
        <div
          role="status"
          className="popover-surface fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-50 flex w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-xl px-3 py-2 shadow-lg"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="font-medium">{first.name}</span> wants to link
            {requests.length > 1 ? ` (+${requests.length - 1} more)` : ""}
          </p>
          <Button
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => setOpen(first)}
          >
            Review
          </Button>
        </div>
      )}
      <IncomingLinkSheet request={open} onClose={() => setOpen(null)} />
    </>
  );
}
