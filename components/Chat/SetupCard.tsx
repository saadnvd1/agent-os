"use client";

import { useState } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  Loader2,
  Minus,
  TriangleAlert,
} from "lucide-react";
import { useSessionSetup } from "@/data/sessions";
import { cn } from "@/lib/utils";
import { useNow } from "./useNow";

const ICONS = {
  pending: Circle,
  running: Loader2,
  ok: Check,
  failed: TriangleAlert,
  skipped: Minus,
};

// A new session's worktree setup, stage by stage, until its agent starts:
// the first message waits for it, so the agent never runs on half-installed
// dependencies.
export function SetupCard({ sessionId }: { sessionId: string }) {
  const { data: setup } = useSessionSetup(sessionId, true);
  const [showLog, setShowLog] = useState(false);
  const running = setup?.status === "running";
  const now = useNow(running);
  if (!setup || (setup.status === "ok" && !setup.stages.length)) return null;
  const seconds = setup.startedAt
    ? Math.max(0, Math.round((now - setup.startedAt) / 1000))
    : null;

  return (
    <div className="bg-card border-border/70 rounded-xl border p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">
          {running
            ? "Setting up the worktree"
            : setup.status === "failed"
              ? "Setup had a problem"
              : "Worktree ready"}
        </span>
        {setup.branch && (
          <code className="text-muted-foreground truncate text-xs">
            {setup.branch}
          </code>
        )}
        {running && seconds !== null && (
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {seconds}s
          </span>
        )}
      </div>
      {setup.stages.length > 0 && (
        <ol className="mt-2 space-y-1">
          {setup.stages.map((s) => {
            const Icon = ICONS[s.state];
            return (
              <li
                key={s.id}
                className={cn(
                  "flex items-center gap-2 text-xs",
                  s.state === "pending" || s.state === "skipped"
                    ? "text-muted-foreground"
                    : s.state === "failed"
                      ? "text-destructive"
                      : "text-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    s.state === "running" && "animate-spin"
                  )}
                />
                {s.label}
              </li>
            );
          })}
        </ol>
      )}
      {setup.error && (
        <p className="text-destructive mt-2 text-xs break-words">
          {setup.error}
        </p>
      )}
      {running && (
        <p className="text-muted-foreground mt-2 text-xs">
          Your message is sent to the agent once this is done.
        </p>
      )}
      {setup.log.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowLog(!showLog)}
            className="text-muted-foreground hover:text-foreground mt-2 flex min-h-11 items-center gap-1 text-xs md:min-h-7"
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                showLog && "rotate-90"
              )}
            />
            Log
          </button>
          {showLog && (
            <pre className="bg-muted/50 max-h-48 overflow-auto rounded-lg p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {setup.log.join("\n")}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
