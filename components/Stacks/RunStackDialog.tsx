"use client";

import { useState } from "react";
import { Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useStackPreview, useStartStack } from "@/data/stacks";
import { cn } from "@/lib/utils";
import { StackTree } from "./StackTree";

const PARALLEL = [1, 2, 3, 4, 5];

// The plan a board would run as, then Start.
export function RunStackDialog({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}) {
  const { data: preview, isPending, error } = useStackPreview(projectId);
  const start = useStartStack();
  const [max, setMax] = useState(3);
  const items = preview?.items ?? [];
  const live = items.filter((i) =>
    ["planned", "held", "running"].includes(i.status)
  );
  const now = live.filter((i) => i.status === "planned" && !i.waitsOn).length;
  const held = live.filter((i) => i.status === "held").length;

  return (
    <Dialog open={!!projectId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Run as stack</DialogTitle>
          <DialogDescription>
            Each card starts once every card it&apos;s blocked by has a PR, on
            top of that card&apos;s branch. Nothing merges until you land it.
          </DialogDescription>
        </DialogHeader>
        {isPending && (
          <div className="bg-muted/40 h-32 animate-pulse rounded-xl" />
        )}
        {error && <p className="text-destructive text-sm">{error.message}</p>}
        {preview && (
          <>
            <p className="text-muted-foreground text-xs">
              {preview.boardName || preview.projectName} · {live.length} card
              {live.length === 1 ? "" : "s"} · {now} start now
              {held ? ` · ${held} held` : ""}
            </p>
            <StackTree items={items} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">At a time</span>
              {PARALLEL.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMax(n)}
                  className={cn(
                    "h-11 w-11 rounded-lg text-sm sm:h-8 sm:w-8",
                    n === max
                      ? "bg-primary text-primary-foreground"
                      : "bg-foreground/[0.05]"
                  )}
                >
                  {n}
                </button>
              ))}
              <span className="flex-1" />
              <Button
                className="h-11 sm:h-9"
                disabled={!live.length || start.isPending}
                onClick={() =>
                  start.mutate(
                    { projectId: preview.projectId, maxParallel: max },
                    { onSuccess: onClose }
                  )
                }
              >
                <Layers className="h-4 w-4" />
                {start.isPending ? "Starting..." : "Start stack"}
              </Button>
            </div>
            {start.error && (
              <p className="text-destructive text-xs">{start.error.message}</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
