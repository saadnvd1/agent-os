"use client";

import { useSnapshot } from "valtio";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCleanupPreview, useDoneIdle } from "@/data/done";
import { useWorkspacesQuery } from "@/data/workspaces";
import type { PreviewRow } from "@/lib/done/bulk";
import { cn } from "@/lib/utils";
import {
  archivedUiActions,
  cleanupUi,
  cleanupUiActions,
} from "@/stores/archivedUi";

const GROUPS: { action: PreviewRow["action"]; title: string; tone: string }[] =
  [
    { action: "cleanup", title: "To clean up", tone: "" },
    {
      action: "merge",
      title: "Open PRs: not merged here, Done each on its own",
      tone: "text-primary",
    },
    {
      action: "refuse",
      title: "Left alone",
      tone: "text-amber-600 dark:text-amber-400",
    },
  ];

// What a clean-up will do with each idle session, before it does it.
export function CleanupDialog() {
  const { workspaceId } = useSnapshot(cleanupUi);
  const { data: rows = [], isPending } = useCleanupPreview(workspaceId);
  const { data: workspaces = [] } = useWorkspacesQuery();
  const doneIdle = useDoneIdle();
  const name = workspaces.find((w) => w.id === workspaceId)?.name ?? "";
  const count = rows.filter((r) => r.action === "cleanup").length;

  const run = () =>
    doneIdle.mutate(workspaceId!, {
      onSuccess: (report) => {
        cleanupUiActions.close();
        archivedUiActions.open(workspaceId, report);
      },
      onError: (e) => toast.error(e.message),
    });

  return (
    <Dialog
      open={!!workspaceId}
      onOpenChange={(o) => !o && cleanupUiActions.close()}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Clean up {name}</DialogTitle>
          <DialogDescription>
            Idle and stopped sessions. Nothing is merged here, and a worktree is
            removed only when nothing in it would be lost.
          </DialogDescription>
        </DialogHeader>
        {isPending && (
          <div className="bg-muted/40 h-24 animate-pulse rounded-xl" />
        )}
        {!isPending && rows.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No idle sessions to clean up.
          </p>
        )}
        {GROUPS.map((g) => {
          const list = rows.filter((r) => r.action === g.action);
          if (!list.length) return null;
          return (
            <div key={g.action} className="space-y-1.5">
              <p className={cn("label-mono text-muted-foreground", g.tone)}>
                {g.title}
              </p>
              {list.map((r) => (
                <div
                  key={r.id}
                  className="bg-foreground/[0.03] rounded-xl px-3 py-2 text-sm"
                >
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="text-muted-foreground text-xs break-words">
                    {r.line}
                  </p>
                </div>
              ))}
            </div>
          );
        })}
        <DialogFooter>
          <Button
            variant="outline"
            className="h-11 md:h-9"
            onClick={cleanupUiActions.close}
          >
            Cancel
          </Button>
          <Button
            className="h-11 md:h-9"
            disabled={!count || doneIdle.isPending}
            onClick={run}
          >
            {doneIdle.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Clean up {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
