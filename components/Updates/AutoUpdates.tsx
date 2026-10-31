"use client";

import { toast } from "sonner";
import { CheckCircle2, CircleAlert, RotateCcw } from "lucide-react";
import { SettingToggle } from "@/components/Settings/SettingToggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAutoUpdateSetting } from "@/data/updates";
import {
  IDLE_MINUTES,
  type AutoUpdateView,
  type UpdateAttempt,
  type UpdateOutcome,
} from "@/lib/updates/banner";

const OUTCOME: Record<UpdateOutcome, string> = {
  done: "Updated",
  build_failed: "Didn't build; nothing changed",
  rolled_back: "Rolled back",
  broken: "Failed, and the rollback too",
  interrupted: "Cut off; will try again",
};

function when(at: number): string {
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Attempt({ a }: { a: UpdateAttempt }) {
  const Icon =
    a.outcome === "done"
      ? CheckCircle2
      : a.outcome === "rolled_back" || a.outcome === "interrupted"
        ? RotateCcw
        : CircleAlert;
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      <Icon
        className={
          a.outcome === "broken"
            ? "text-destructive mt-0.5 h-4 w-4 shrink-0"
            : "text-muted-foreground mt-0.5 h-4 w-4 shrink-0"
        }
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap justify-between gap-x-3">
          <span className="font-medium">
            {a.toVersion || a.to.slice(0, 7)}
            <span className="text-muted-foreground font-normal">
              {" "}
              · {OUTCOME[a.outcome]}
              {a.auto ? "" : " (by hand)"}
            </span>
          </span>
          <span className="text-muted-foreground text-xs">
            {when(a.finishedAt)}
          </span>
        </p>
        {a.error && a.outcome !== "done" && (
          <p className="text-muted-foreground text-xs break-words">{a.error}</p>
        )}
      </div>
    </li>
  );
}

// Settings > Updates: the switch for automatic updates, how long everything
// must be idle first, what it's doing now, and how the last ones went.
export function AutoUpdates({ auto }: { auto: AutoUpdateView }) {
  const save = useAutoUpdateSetting();
  const onError = (e: Error) => toast.error(e.message);
  return (
    <div className="space-y-3">
      <SettingToggle
        title="Install updates automatically"
        detail="Once everything has been idle for a while. Terminals and chats keep running through the restart, and a version that doesn't start cleanly is rolled back."
        checked={auto.enabled}
        locked={auto.locked}
        onChange={(on) => save.mutate({ auto: on }, { onError })}
      />
      {auto.enabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3">
          <label htmlFor="auto-idle" className="text-sm">
            Idle for
          </label>
          <Select
            value={String(auto.idleMinutes)}
            disabled={auto.idleLocked}
            onValueChange={(v) =>
              save.mutate({ idleMinutes: Number(v) }, { onError })
            }
          >
            <SelectTrigger id="auto-idle" className="min-h-11 w-36 md:min-h-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IDLE_MINUTES.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} minutes
                </SelectItem>
              ))}
              {!(IDLE_MINUTES as readonly number[]).includes(
                auto.idleMinutes
              ) && (
                <SelectItem value={String(auto.idleMinutes)}>
                  {auto.idleMinutes} minutes
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      )}
      {auto.status && auto.status.code !== "off" && (
        <p className="text-muted-foreground px-3 text-xs" role="status">
          {auto.status.text}
        </p>
      )}
      {auto.attempts.length > 0 && (
        <div className="px-3">
          <p className="text-muted-foreground text-xs font-medium">
            Recent updates
          </p>
          <ul className="divide-border divide-y">
            {auto.attempts.map((a) => (
              <Attempt key={a.id} a={a} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
