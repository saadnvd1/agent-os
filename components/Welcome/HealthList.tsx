"use client";

import { AlertTriangle, Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDoctorQuery, useRecheckDoctor } from "@/data/doctor";
import type { CheckStatus } from "@/lib/doctor/checks";
import { cn } from "@/lib/utils";

const ICON = { ok: Check, warn: AlertTriangle, fail: X } as const;
const TONE: Record<CheckStatus, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-destructive",
};

/** What this machine needs to run AgentOS, one line per tool. */
export function HealthList() {
  const { data: checks, isPending, isError } = useDoctorQuery();
  const recheck = useRecheckDoctor();
  return (
    <div className="flex flex-col gap-2">
      {isPending && (
        <div className="bg-muted/40 h-24 animate-pulse rounded-lg" />
      )}
      {isError && (
        <p className="text-destructive text-sm">
          Couldn&apos;t run the health checks.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {checks?.map((c) => {
          const Icon = ICON[c.status];
          return (
            <li
              key={c.id}
              className="bg-muted/40 flex min-h-11 items-start gap-3 rounded-lg px-3 py-2"
            >
              <Icon
                aria-label={c.status}
                className={cn("mt-0.5 size-4 shrink-0", TONE[c.status])}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-muted-foreground text-xs break-words">
                  {c.detail}
                </p>
                {c.fix && c.status !== "ok" && (
                  <code className="bg-background mt-1 block rounded px-2 py-1 text-xs break-all">
                    {c.fix}
                  </code>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        className="self-end"
        disabled={recheck.isPending}
        onClick={() => recheck.mutate()}
      >
        <RefreshCw className={recheck.isPending ? "animate-spin" : ""} />
        Check again
      </Button>
    </div>
  );
}
