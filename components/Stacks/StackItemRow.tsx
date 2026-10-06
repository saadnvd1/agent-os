"use client";

import { useState } from "react";
import { ExternalLink, KanbanSquare, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StackItemView } from "@/lib/stacks/types";
import { useStackItemAction } from "@/data/stacks";
import { StatusChip } from "./StatusChip";

const LIVE = new Set(["planned", "held", "running", "pr", "failed"]);

// One card in the tree. Without a stack id it is a read-only plan row.
export function StackItemRow({
  item,
  stackId,
}: {
  item: StackItemView;
  stackId?: string;
}) {
  const action = useStackItemAction();
  const [confirmDrop, setConfirmDrop] = useState(false);
  const attention =
    !!item.error && (item.status === "pr" || item.status === "running");
  const why = item.error || item.waitsOn || item.note;
  const busy = action.isPending;
  const act = (kind: "drop" | "restack") =>
    stackId && action.mutate({ id: stackId, itemId: item.id, action: kind });

  return (
    <div
      className="bg-foreground/[0.03] space-y-1 rounded-lg px-3 py-2"
      style={{ marginLeft: `${Math.min(item.depth, 6) * 14}px` }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            {item.ticket && (
              <span className="text-muted-foreground mr-1.5 font-mono text-[11px]">
                {item.ticket}
              </span>
            )}
            {item.title}
          </p>
        </div>
        <StatusChip status={item.status} attention={attention} />
      </div>
      {why && (
        <p
          className={
            item.error
              ? "text-xs break-words text-amber-700 dark:text-amber-300"
              : "text-muted-foreground text-xs"
          }
        >
          {why}
        </p>
      )}
      {item.also.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Also waits on {item.also.join(", ")}, whose work isn&apos;t in its
          base
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {item.prUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="h-11 px-2 text-xs sm:h-7"
            asChild
          >
            <a href={item.prUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3 w-3" />
              PR #{item.prNumber}
            </a>
          </Button>
        )}
        {item.cardUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="h-11 px-2 text-xs sm:h-7"
            asChild
          >
            <a href={item.cardUrl} target="_blank" rel="noreferrer">
              <KanbanSquare className="h-3 w-3" />
              Card
            </a>
          </Button>
        )}
        <span className="flex-1" />
        {stackId && attention && item.parentId && (
          <Button
            size="sm"
            variant="ghost"
            className="h-11 px-2 text-xs sm:h-7"
            disabled={busy}
            onClick={() => act("restack")}
          >
            <RotateCw className="h-3 w-3" />
            Restack
          </Button>
        )}
        {stackId &&
          LIVE.has(item.status) &&
          (confirmDrop ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-11 px-2 text-xs sm:h-7"
              disabled={busy}
              onClick={() => act("drop")}
            >
              Confirm drop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-11 px-2 text-xs sm:h-7"
              onClick={() => setConfirmDrop(true)}
            >
              <X className="h-3 w-3" />
              Drop
            </Button>
          ))}
      </div>
      {action.error && (
        <p className="text-destructive text-xs">{action.error.message}</p>
      )}
    </div>
  );
}
