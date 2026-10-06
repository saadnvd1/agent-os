"use client";

import { ArchiveRestore, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUnarchiveSession } from "@/data/done";
import type { ArchivedView } from "@/lib/done/archive";
import { fromSqliteTime } from "@/lib/session-meta";

const STATUS: Record<string, string> = {
  merged: "Merged",
  done: "Done",
  dropped: "Dropped",
  running: "Task",
};

function when(at: string): string {
  return fromSqliteTime(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ArchivedRow({ session }: { session: ArchivedView }) {
  const unarchive = useUnarchiveSession();
  const kind = session.taskStatus ? STATUS[session.taskStatus] : "Session";

  return (
    <div className="bg-foreground/[0.03] flex items-center gap-3 rounded-xl px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{session.name}</p>
        <p className="text-muted-foreground truncate font-mono text-[11px]">
          {[session.projectName, kind, when(session.archivedAt)]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {session.keptWorktree && (
          <p className="font-mono text-[11px] break-all text-amber-600 dark:text-amber-400">
            worktree kept: {session.keptWorktree}
          </p>
        )}
      </div>
      {session.prUrl && (
        <Button size="icon-sm" variant="ghost" asChild aria-label="Open PR">
          <a href={session.prUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-11 shrink-0 md:h-8"
        disabled={unarchive.isPending}
        onClick={() =>
          unarchive.mutate(session.id, {
            onSuccess: () => toast.success(`${session.name} is back`),
            onError: (e) => toast.error(e.message),
          })
        }
      >
        {unarchive.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArchiveRestore className="h-3.5 w-3.5" />
        )}
        Unarchive
      </Button>
    </div>
  );
}
