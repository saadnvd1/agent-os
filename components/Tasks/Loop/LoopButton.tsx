"use client";

import { useState } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { useLoopSummaries, useTaskLoop } from "@/data/loops";
import { LoopSetup } from "./LoopSetup";
import { LoopView } from "./LoopView";

function LoopBody({ taskId }: { taskId: string }) {
  const q = useTaskLoop(taskId);
  const [setup, setSetup] = useState(false);
  if (q.isPending)
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (q.isError)
    return <p className="text-sm text-red-500">{q.error.message}</p>;
  const view = q.data;
  const live = view?.loop.state === "running";
  if (!view || setup) {
    return <LoopSetup taskId={taskId} onStarted={() => setSetup(false)} />;
  }
  return (
    <div className="space-y-4">
      <LoopView taskId={taskId} view={view} />
      {!live && (
        <Button
          className="h-11 w-full md:h-9"
          variant="outline"
          onClick={() => setSetup(true)}
        >
          Start a new loop
        </Button>
      )}
    </div>
  );
}

// The pill and button on a task row: the analyst loop for this task.
export function LoopButton({ taskId, name }: { taskId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const summary = useLoopSummaries().data?.[taskId];
  const live = summary?.state === "running";
  return (
    <>
      {live && summary && (
        <StatusPill tone="amber">
          Loop {summary.cycle}/{summary.maxCycles} · {summary.met}/
          {summary.total}
        </StatusPill>
      )}
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Repeat className="h-3.5 w-3.5" />
        Loop
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Analyst loop</DialogTitle>
            <DialogDescription className="truncate">{name}</DialogDescription>
          </DialogHeader>
          {open && <LoopBody taskId={taskId} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
