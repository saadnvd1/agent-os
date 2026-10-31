"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogAgent } from "@/lib/machines/types";
import type { AgentType } from "@/lib/providers";
import { catalogBlocker } from "../catalogBlocker";

const initials = (label: string) => {
  const w = label.split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : label.slice(0, 2)).toUpperCase();
};

const Mark = ({ label }: { label: string }) => (
  <span className="bg-muted text-muted-foreground grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold">
    {initials(label)}
  </span>
);

const Dot = ({ login }: { login: boolean }) => (
  <i
    className={cn(
      "h-1.5 w-1.5 shrink-0 rounded-full",
      login ? "bg-amber-500" : "bg-muted-foreground/40"
    )}
  />
);

/** Agents down the left on a desktop, with how many models each has. */
export function AgentRail({
  agents,
  browsing,
  onBrowse,
}: {
  agents: CatalogAgent[];
  browsing: AgentType;
  onBrowse: (agent: AgentType) => void;
}) {
  const [more, setMore] = useState(false);
  const ready = agents.filter((a) => !catalogBlocker(a));
  const other = agents.filter((a) => catalogBlocker(a));
  return (
    <nav
      aria-label="Agents"
      className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto p-1.5"
    >
      {ready.map((a) => (
        <button
          key={a.agent}
          type="button"
          aria-current={a.agent === browsing}
          onClick={() => onBrowse(a.agent)}
          className={cn(
            "hover:bg-foreground/[0.05] flex h-10 items-center gap-2 rounded-lg px-2 text-left text-sm",
            a.agent === browsing && "bg-primary/10 font-medium"
          )}
        >
          <Mark label={a.label} />
          <span className="min-w-0 flex-1 truncate">{a.label}</span>
          <span className="text-muted-foreground text-xs">
            {a.models.length || "–"}
          </span>
        </button>
      ))}
      {other.length > 0 && (
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore(!more)}
          className="text-muted-foreground hover:text-foreground flex h-9 items-center justify-between rounded-lg px-2 text-[11px] font-medium"
        >
          Not installed · {other.length}
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", more && "rotate-180")}
          />
        </button>
      )}
      {more &&
        other.map((a) => (
          <div
            key={a.agent}
            className="text-muted-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm opacity-70"
          >
            <Mark label={a.label} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{a.label}</span>
              <span className="truncate text-[11px]">{catalogBlocker(a)}</span>
            </span>
            <Dot login={a.auth === "needs-login"} />
          </div>
        ))}
    </nav>
  );
}

/** The same agents as a row to swipe along, for a phone. */
export function AgentStrip({
  agents,
  browsing,
  lastAgent,
  onBrowse,
}: {
  agents: CatalogAgent[];
  browsing: AgentType;
  lastAgent?: AgentType;
  onBrowse: (agent: AgentType) => void;
}) {
  return (
    <div
      aria-label="Agents"
      className="flex shrink-0 [scrollbar-width:none] gap-1.5 overflow-x-auto px-3 py-1.5"
    >
      {agents.map((a) => {
        const blocked = catalogBlocker(a);
        return blocked ? (
          <span
            key={a.agent}
            className="text-muted-foreground flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm opacity-60"
          >
            <Dot login={a.auth === "needs-login"} />
            {a.label}
            <span className="text-[11px]">{blocked}</span>
          </span>
        ) : (
          <button
            key={a.agent}
            type="button"
            aria-pressed={a.agent === browsing}
            onClick={() => onBrowse(a.agent)}
            className={cn(
              "bg-foreground/[0.05] flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm",
              a.agent === browsing && "bg-primary/15 text-primary font-medium"
            )}
          >
            {a.label}
            {a.agent === lastAgent && (
              <i className="bg-primary h-1.5 w-1.5 rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
