"use client";

import { useState } from "react";
import { Pause, Play, RefreshCw, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StackView } from "@/lib/stacks/types";
import { useStackAction, type StackAction } from "@/data/stacks";
import { StatusChip } from "./StatusChip";
import { StackTree } from "./StackTree";

function counts(stack: StackView): string {
  const n = (s: string) => stack.items.filter((i) => i.status === s).length;
  const parts = [
    [n("merged"), "merged"],
    [n("pr"), "with a PR"],
    [n("running"), "working"],
    [n("planned") + n("held"), "to go"],
  ] as const;
  return parts
    .filter(([c]) => c > 0)
    .map(([c, w]) => `${c} ${w}`)
    .join(" · ");
}

export function StackCard({ stack }: { stack: StackView }) {
  const action = useStackAction();
  const [confirmLand, setConfirmLand] = useState(false);
  const prs = stack.items.filter((i) => i.status === "pr").length;
  const run = (kind: StackAction) => {
    setConfirmLand(false);
    action.mutate({ id: stack.id, action: kind });
  };
  const btn = "h-11 sm:h-8";

  return (
    <div className="bg-foreground/[0.03] space-y-3 rounded-xl px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{stack.name}</p>
          <p className="text-muted-foreground text-[11px]">
            {stack.projectName} · {counts(stack) || "nothing yet"} ·{" "}
            {stack.maxParallel} at a time
          </p>
        </div>
        <StatusChip status={stack.status} stack />
      </div>
      {stack.progress && <p className="text-xs">{stack.progress}</p>}
      {stack.error && (
        <p className="text-destructive text-xs break-words whitespace-pre-wrap">
          {stack.error}
        </p>
      )}
      <StackTree items={stack.items} stackId={stack.id} />
      {stack.status !== "landed" && (
        <div className="flex flex-wrap items-center gap-2">
          {stack.status === "running" && (
            <Button
              size="sm"
              variant="outline"
              className={btn}
              disabled={action.isPending}
              onClick={() => run("pause")}
            >
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          )}
          {(stack.status === "paused" || stack.status === "failed") && (
            <Button
              size="sm"
              variant="outline"
              className={btn}
              disabled={action.isPending}
              onClick={() => run("resume")}
            >
              <Play className="h-3.5 w-3.5" />
              Resume
            </Button>
          )}
          {stack.status === "running" && (
            <Button
              size="sm"
              variant="ghost"
              className={btn}
              disabled={action.isPending}
              onClick={() => run("tick")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Check now
            </Button>
          )}
          <span className="flex-1" />
          {stack.status !== "landing" &&
            prs > 0 &&
            (confirmLand ? (
              <Button
                size="sm"
                className={btn}
                disabled={action.isPending}
                onClick={() => run("land")}
              >
                Merge {prs} PR{prs === 1 ? "" : "s"} bottom-up
              </Button>
            ) : (
              <Button
                size="sm"
                className={btn}
                onClick={() => setConfirmLand(true)}
              >
                <Rocket className="h-3.5 w-3.5" />
                Land
              </Button>
            ))}
        </div>
      )}
      {action.error && (
        <p className="text-destructive text-xs">{action.error.message}</p>
      )}
    </div>
  );
}
