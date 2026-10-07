"use client";

import { memo, useState, useSyncExternalStore } from "react";
import { ChevronDown, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePauseOrchestrator } from "@/data/orchestrators";
import { useOrchestratorHeader } from "@/hooks/useOrchestratorHeader";
import { headerParts } from "@/lib/orchestrator/header-line";
import { cn } from "@/lib/utils";
import { NO_PASSKEYS_HERE, passkeysHere } from "@/data/presence";
import { AsksList } from "./AsksList";

// The top of an orchestrator's chat: the workspace header line, Pause or
// Resume, and its asks for the owner. Memoized: the chat under it re-renders for
// every streamed word.
export const OrchestratorBar = memo(function OrchestratorBar({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { overview, counts } = useOrchestratorHeader(workspaceId);
  const pause = usePauseOrchestrator(workspaceId);
  const [open, setOpen] = useState(true);
  const canProve = useSyncExternalStore(
    () => () => {},
    passkeysHere,
    () => true
  );
  const asks = overview?.asks ?? [];
  const toggle = () =>
    pause.mutate(!counts.paused, {
      onError: (e) => toast.error(e.message),
    });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 px-3 pt-3">
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl py-1.5 pr-1.5 pl-3",
          counts.paused ? "bg-amber-500/10" : "bg-foreground/[0.03]"
        )}
      >
        <p className="min-w-0 flex-1 text-sm leading-snug md:truncate">
          <span className="font-medium">Orchestrator</span>
          {headerParts(counts).map((part) => (
            <span
              key={part}
              className={cn(
                part === "paused"
                  ? "font-medium text-amber-700 dark:text-amber-300"
                  : /\basks?$/.test(part)
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
              )}
            >
              {" · "}
              {part}
            </span>
          ))}
        </p>
        <Button
          size="sm"
          variant={counts.paused ? "default" : "secondary"}
          className="h-11 md:h-8"
          disabled={
            !overview || pause.isPending || (counts.paused && !canProve)
          }
          title={counts.paused && !canProve ? NO_PASSKEYS_HERE : undefined}
          onClick={toggle}
        >
          {counts.paused ? <Play /> : <Pause />}
          {counts.paused ? "Resume" : "Pause"}
        </Button>
      </div>
      {counts.paused && (
        <p className="text-muted-foreground px-1 text-xs">
          Paused: events wait and it won&apos;t start, merge or message anything
          until you resume. You can still talk to it.
        </p>
      )}
      {asks.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="label-mono flex min-h-11 w-full items-center gap-1.5 px-1 text-amber-600 md:min-h-8 dark:text-amber-400"
          >
            {asks.length} {asks.length === 1 ? "ask" : "asks"} for you
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                !open && "-rotate-90"
              )}
            />
          </button>
          {open && (
            <div className="max-h-[45vh] overflow-y-auto pb-1">
              <AsksList workspaceId={workspaceId} asks={asks} />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
