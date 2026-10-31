"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { CopyButton } from "@/components/Chat/CopyButton";
import { useReachQuery, useRecheckReach } from "@/data/reach";
import type { ReachFinding, ReachReport, ReachStatus } from "@/lib/reach/types";
import { cn } from "@/lib/utils";

const TONE: Record<ReachStatus, "green" | "amber" | "red"> = {
  ok: "green",
  warn: "amber",
  fail: "red",
};

// Amber has three stories: only retrying, one way in working, or a warning.
function pillLabel(report: ReachReport, problems: ReachFinding[]): string {
  if (report.status === "ok") return "Reachable";
  if (report.status === "fail") return "Not reachable";
  if (problems.every((f) => f.needs === "nothing")) return "Reconnecting";
  return report.url ? "Partly reachable" : "Needs a look";
}

// A fix is a command when it starts with one; otherwise it's plain advice.
const isCommand = (fix: string) => /^(agent-os|sudo)( |$)/.test(fix);

function Problem({ f }: { f: ReachFinding }) {
  return (
    <li className="flex flex-col gap-1">
      <p className="text-sm font-medium">{f.title}</p>
      {f.needs === "nothing" ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Loader2 className="size-3 animate-spin" />
          Retrying on its own, nothing to do
        </p>
      ) : (
        <>
          {f.fix &&
            (isCommand(f.fix) ? (
              <code className="bg-background block rounded px-2 py-1 text-xs break-all">
                {f.fix}
              </code>
            ) : (
              <p className="text-muted-foreground text-xs break-words">
                {f.fix}
              </p>
            ))}
          {f.guide && (
            <a
              href={f.guide}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground flex min-h-11 w-fit items-center text-xs underline underline-offset-2 sm:min-h-6"
            >
              How to fix
            </a>
          )}
        </>
      )}
    </li>
  );
}

/** Whether other devices can reach this machine, and the fix when they can't. */
export function ReachRow({
  enabled = true,
  className,
}: {
  enabled?: boolean;
  className?: string;
}) {
  const { data, isPending, isError } = useReachQuery(enabled);
  const recheck = useRecheckReach();
  if (isPending)
    return (
      <div
        className={cn("bg-muted/40 h-16 animate-pulse rounded-lg", className)}
      />
    );
  const problems = data?.findings.filter((f) => f.status !== "ok") ?? [];
  const pill = data && {
    tone: TONE[data.status],
    label: pillLabel(data, problems),
  };
  return (
    <div
      className={cn(
        "bg-muted/40 flex flex-col gap-2 rounded-lg px-3 py-2.5",
        className
      )}
    >
      <div className="flex min-h-11 items-center gap-2 sm:min-h-0">
        <p className="min-w-0 flex-1 text-sm font-medium">
          Reachable from other devices
        </p>
        {pill && (
          <StatusPill tone={pill.tone} className="shrink-0 whitespace-nowrap">
            {pill.label}
          </StatusPill>
        )}
      </div>
      {isError && (
        <p className="text-destructive text-xs">Couldn&apos;t run the check.</p>
      )}
      {data?.url && (
        <div className="flex min-w-0 items-center gap-1">
          <span className="text-foreground min-w-0 flex-1 truncate font-mono text-xs">
            {data.url}
          </span>
          <CopyButton
            text={data.url}
            label="Copy link"
            className="h-11 w-11 shrink-0 md:h-7 md:w-7"
          />
        </div>
      )}
      {problems.length > 0 && (
        <ul className="flex flex-col gap-3">
          {problems.map((f, i) => (
            <Problem key={`${f.route ?? ""}-${f.cause ?? i}`} f={f} />
          ))}
        </ul>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-11 self-end sm:h-8"
        disabled={recheck.isPending}
        onClick={() => recheck.mutate()}
      >
        <RefreshCw className={recheck.isPending ? "animate-spin" : ""} />
        Check again
      </Button>
    </div>
  );
}
