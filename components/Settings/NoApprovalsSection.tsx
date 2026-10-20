"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingToggle } from "@/components/Settings/SettingToggle";
import { useApprovalsModeQuery, useSetApprovalsMode } from "@/data/approvals";

// What it switches off, said plainly before it can be switched on.
export const NO_APPROVALS_WARNING = [
  "Every ask is approved the moment it is raised, hard lines included: public posts and messages, money, irreversible or destructive changes, credentials.",
  "A PR stuck failing its gates, with no CI, or too big to review still merges.",
  "Brakes stop holding new starts. Plan-only tasks still wait for approve_plan.",
  "Every agent AgentOS starts runs with its permission prompts off, and prompts already waiting are allowed.",
];

export function NoApprovalsSection() {
  const { data, isPending, isError, error } = useApprovalsModeQuery();
  const set = useSetApprovalsMode();
  const [confirming, setConfirming] = useState(false);

  if (isPending)
    return <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;

  return (
    <div className="space-y-3">
      <SettingToggle
        title="No approvals"
        detail="Shuts off every approval AgentOS would otherwise wait on, and every agent's permission prompts. Off by default."
        checked={data.on}
        onChange={(on) => {
          if (on) setConfirming(true);
          else set.mutate(false);
        }}
      />
      {confirming && !data.on && (
        <div
          role="alertdialog"
          aria-label="Turn on No approvals"
          className="rounded-lg border border-red-500/20 bg-red-500/10 p-3"
        >
          <p className="mb-2 text-sm font-medium text-red-400">
            Turn on No approvals?
          </p>
          <ul className="text-muted-foreground mb-3 list-disc space-y-1 pl-5 text-xs">
            {NO_APPROVALS_WARNING.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>
              Terminals already running in an agent other than Claude keep
              asking until they are restarted. Each approval made for you is
              logged below.
            </li>
          </ul>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={set.isPending}
              onClick={() =>
                set.mutate(true, { onSuccess: () => setConfirming(false) })
              }
            >
              {set.isPending ? "Turning on..." : "Turn on No approvals"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={set.isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {set.error && (
        <p className="text-destructive text-xs">{set.error.message}</p>
      )}
      <div>
        <p className="mb-1 text-sm font-medium">Approved for you</p>
        {data.audit.length === 0 ? (
          <p className="text-muted-foreground text-xs">Nothing yet.</p>
        ) : (
          <ul className="space-y-1">
            {data.audit.map((row) => (
              <li key={row.id} className="text-xs">
                <span className="text-muted-foreground">
                  {row.at} · {row.source} ·{" "}
                </span>
                {row.subject}
                {row.detail ? (
                  <span className="text-muted-foreground"> ({row.detail})</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
