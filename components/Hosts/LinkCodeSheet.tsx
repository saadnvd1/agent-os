"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCancelLink, useConfirmLink, useOutgoingLink } from "@/data/peers";
import { showCode } from "@/lib/peer/code";
import { SHEET } from "./sheet";

const ENDED: Record<string, string> = {
  declined: "It was declined there, or the code was typed wrong 3 times.",
  expired: "The request expired before the code was typed.",
};

/** Once the other machine took our code: type the one it shows now. */
function ConfirmForm({
  id,
  name,
  onCancel,
}: {
  id: string;
  name: string;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const confirm = useConfirmLink();
  const digits = code.replace(/\D/g, "");
  const left = (confirm.error as { attemptsLeft?: number } | null)
    ?.attemptsLeft;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (digits.length === 6) confirm.mutate({ id, code: digits });
      }}
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.slice(0, 7))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="6-digit code"
        aria-label={`Code shown on ${name}`}
        className="h-12 text-center font-mono text-2xl tracking-[0.3em]"
        autoFocus
      />
      {confirm.error && (
        <p className="text-destructive text-sm">
          {confirm.error.message}
          {left ? ` ${left} ${left === 1 ? "try" : "tries"} left.` : ""}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 sm:min-h-9"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="min-h-11 sm:min-h-9"
          disabled={confirm.isPending || digits.length !== 6 || left === 0}
        >
          Finish
        </Button>
      </div>
    </form>
  );
}

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
    if ((link?.state === "pending" || link?.state === "confirm") && linkId)
      cancel.mutate(linkId);
    onClose();
  };
  const name = link?.name ?? "the other machine";

  return (
    <Dialog open={!!linkId} onOpenChange={(o) => !o && close()}>
      <DialogContent className={SHEET}>
        <DialogHeader>
          <DialogTitle>Link {name}</DialogTitle>
          <DialogDescription>
            {link?.state === "confirm" ? (
              <>
                Last step: {name} shows a code of its own. Typing it here proves
                it&apos;s really {name}.
              </>
            ) : link?.state === "accepted" ? (
              <>Both machines list each other as linked now.</>
            ) : (
              <>
                Open AgentOS on {name} and type this code there. Its banner, the
                Machines screen, or{" "}
                <code className="font-mono">agent-os link accept</code> in its
                terminal all take it.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {link?.state === "confirm" && (
          <ConfirmForm id={link.id} name={name} onCancel={close} />
        )}
        {link && link.state !== "confirm" && link.state !== "accepted" && (
          <p
            className="text-center font-mono text-4xl font-semibold tracking-[0.2em] tabular-nums sm:text-5xl"
            aria-label={`Code ${link.code.split("").join(" ")}`}
            data-testid="link-code"
          >
            {showCode(link.code)}
          </p>
        )}
        {link?.state !== "confirm" && (
          <>
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
              {link && !["pending", "accepted"].includes(link.state) && (
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
