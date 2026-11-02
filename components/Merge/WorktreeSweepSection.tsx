"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useSetSweepDays, useWorktreeSweep } from "@/data/worktree-sweep";
import { compactTimeAgo, fromSqliteTime } from "@/lib/session-meta";
import { formatBytes } from "@/lib/share/view";
import { parseSettingNumber } from "@/lib/settings/parse";
import { MAX_SWEEP_DAYS } from "@/lib/worktree-sweep/limits";

// Days as the box shows them; empty means "inherit".
function DaysInput({
  value,
  placeholder,
  disabled,
  onSave,
}: {
  value: number | null;
  placeholder: string;
  disabled: boolean;
  onSave: (days: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const raw = text.trim();
    let next: number | null = null;
    if (raw !== "") {
      const parsed = parseSettingNumber(raw, { min: 0, max: MAX_SWEEP_DAYS });
      if ("error" in parsed) return setError(parsed.error);
      next = parsed.value;
    }
    setError(null);
    if (next !== value) onSave(next);
  };
  return (
    <span className="flex flex-col gap-1">
      <Input
        aria-label="Days before a settled worktree is removed"
        aria-invalid={!!error}
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(value === null ? "" : String(value));
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className="h-11 w-24 text-right tabular-nums md:h-9"
      />
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}

function LastRun() {
  const { data } = useWorktreeSweep();
  const last = data?.runs.find((r) => r.finishedAt && !r.dryRun);
  if (!last) return null;
  return (
    <p className="text-muted-foreground text-xs">
      Last run {compactTimeAgo(fromSqliteTime(last.finishedAt!))}: removed{" "}
      {last.removed}, {formatBytes(last.freedBytes)} freed, {last.skipped}{" "}
      skipped. Details in Health &gt; Clean-up.
    </p>
  );
}

// How long a settled worktree stays on disk. The branch and the conversation
// stay; restoring the session rebuilds it.
export function GlobalSweepSection() {
  const { data, isPending, isError, error } = useWorktreeSweep();
  const save = useSetSweepDays();
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Worktree clean-up</h3>
      <p className="text-muted-foreground text-sm">
        Remove the worktree of a merged, dropped, done or archived session this
        many days after it settled, when nothing in it would be lost. 0 turns it
        off.
      </p>
      {isPending && (
        <div className="bg-muted/40 h-11 animate-pulse rounded-lg" />
      )}
      {isError && <p className="text-destructive text-sm">{error.message}</p>}
      {data && (
        <div className="flex items-center gap-3">
          <DaysInput
            key={data.days ?? "none"}
            value={data.days}
            placeholder={String(data.defaultDays)}
            disabled={save.isPending}
            onSave={(days) => save.mutate({ days })}
          />
          <span className="text-muted-foreground text-sm">days</span>
        </div>
      )}
      {data && data.overrides.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Own number:{" "}
          {data.overrides.map((o) => `${o.name} (${o.days})`).join(", ")}
        </p>
      )}
      {save.isError && (
        <p className="text-destructive text-sm">{save.error.message}</p>
      )}
      <LastRun />
    </div>
  );
}

export function ProjectSweepSection({ projectId }: { projectId: string }) {
  const { data } = useWorktreeSweep();
  const save = useSetSweepDays();
  const own =
    data?.overrides.find((o) => o.projectId === projectId)?.days ?? null;
  const inherited = data?.days ?? data?.defaultDays ?? 7;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Worktree clean-up</h3>
      <div className="flex items-center gap-3">
        <DaysInput
          key={own ?? "none"}
          value={own}
          placeholder={String(inherited)}
          disabled={!data || save.isPending}
          onSave={(days) => save.mutate({ days, projectId })}
        />
        <span className="text-muted-foreground text-sm">
          days after a session settles (empty: {inherited}, 0: off)
        </span>
      </div>
      {save.isError && (
        <p className="text-destructive text-sm">{save.error.message}</p>
      )}
    </div>
  );
}
