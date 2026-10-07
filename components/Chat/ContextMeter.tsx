"use client";

import { useSnapshot } from "valtio";
import { Minimize2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTokens, meterLevel } from "@/lib/chat/context";
import { cn } from "@/lib/utils";
import { chatMeta, chatMetaActions } from "@/stores/chatMeta";

const LEVEL_COLOR = {
  ok: "text-primary",
  warn: "text-amber-500",
  high: "text-destructive",
} as const;

// A ring for how full the chat's context window is; tap for the breakdown
// and /compact. Nothing for a session that isn't an open chat.
export function ContextMeter({
  sessionId,
  compact = false,
}: {
  sessionId?: string | null;
  // In the phone's composer: the ring alone, at full touch size.
  compact?: boolean;
}) {
  const snap = useSnapshot(chatMeta);
  const meta = sessionId ? snap.sessions[sessionId] : undefined;
  if (!sessionId || !meta?.context) return null;
  const c = meta.context;
  const level = meterLevel(c.percentage);
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const filled = Math.min(c.percentage, 100) / 100;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Context ${c.percentage}% used`}
          title={`Context: ${formatTokens(c.usedTokens)} of ${formatTokens(c.maxTokens)}`}
          className={cn(
            "hover:bg-foreground/[0.05] flex shrink-0 items-center justify-center gap-1 rounded-md",
            compact ? "h-10 w-10" : "h-7 min-w-7 px-1.5"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <svg viewBox="0 0 18 18" className="h-4 w-4 -rotate-90">
            <circle
              cx="9"
              cy="9"
              r={r}
              fill="none"
              strokeWidth="2.5"
              className="stroke-foreground/10"
            />
            <circle
              cx="9"
              cy="9"
              r={r}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              stroke="currentColor"
              strokeDasharray={`${filled * circumference} ${circumference}`}
              className={LEVEL_COLOR[level]}
            />
          </svg>
          <span
            className={cn(
              "text-[11px] tabular-nums",
              compact && "sr-only",
              level === "ok" ? "text-muted-foreground" : LEVEL_COLOR[level]
            )}
          >
            {c.percentage}%
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="space-y-2 px-2 py-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">Context</span>
            <span className="text-muted-foreground tabular-nums">
              {formatTokens(c.usedTokens)} / {formatTokens(c.maxTokens)}
            </span>
          </div>
          <div className="bg-foreground/10 h-1.5 overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full",
                level === "ok"
                  ? "bg-primary"
                  : level === "warn"
                    ? "bg-amber-500"
                    : "bg-destructive"
              )}
              style={{ width: `${filled * 100}%` }}
            />
          </div>
          <ul className="text-muted-foreground space-y-0.5 text-xs">
            {[...c.categories]
              .sort((a, b) => b.tokens - a.tokens)
              .map((cat) => (
                <li key={cat.name} className="flex justify-between gap-2">
                  <span className="truncate">{cat.name}</span>
                  <span className="tabular-nums">
                    {formatTokens(cat.tokens)}
                  </span>
                </li>
              ))}
          </ul>
          <p className="text-muted-foreground/70 text-[11px]">
            Measured against the room before auto-compact, after the last turn.
          </p>
        </div>
        <DropdownMenuItem
          disabled={meta.running}
          className="min-h-11 gap-2 md:min-h-9"
          onSelect={() => chatMetaActions.actions(sessionId)?.send("/compact")}
        >
          <Minimize2 className="h-4 w-4" />
          Compact now
          <span className="text-muted-foreground ml-auto font-mono text-xs">
            /compact
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
