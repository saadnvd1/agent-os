"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCancelUpdate, useRunUpdate } from "@/data/updates";
import { workingTotal, type UpdateView } from "@/lib/updates/banner";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const toastError = (e: unknown) =>
  toast.error(e instanceof Error ? e.message : String(e));

/** What a restart cuts, in words. */
export function workingWarning(w: UpdateView["working"]): string {
  const parts: string[] = [];
  if (w.sessions) parts.push(`${plural(w.sessions, "session")} working`);
  if (w.reviews) parts.push(`${plural(w.reviews, "review")} running`);
  if (w.setups) parts.push(`${plural(w.setups, "task setup")} running`);
  return parts.join(", ");
}

/**
 * Update now, or Cancel for an update waiting for quiet. When something is
 * working, Update now asks first and offers to wait.
 */
export function UpdateActions({ view }: { view: UpdateView }) {
  const run = useRunUpdate();
  const cancel = useCancelUpdate();
  const [confirm, setConfirm] = useState(false);
  const busy = workingTotal(view.working) > 0;

  if (view.pending)
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate(undefined, { onError: toastError })}
      >
        Cancel
      </Button>
    );
  if (!view.canUpdate.ok) return null;

  const start = (when: "now" | "idle") => {
    setConfirm(false);
    run.mutate(when, { onError: toastError });
  };

  return (
    <>
      <Button
        size="sm"
        disabled={run.isPending}
        onClick={() => (busy ? setConfirm(true) : start("now"))}
      >
        Update now
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update while work is running?</DialogTitle>
            <DialogDescription>
              {workingWarning(view.working)}. Terminals and chats keep running
              through the restart; reviews and task setups in progress start
              over when AgentOS is back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 max-sm:flex-col-reverse">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => start("now")}>
              Update now
            </Button>
            <Button onClick={() => start("idle")}>Update when idle</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
