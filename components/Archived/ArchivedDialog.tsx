"use client";

import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useArchivedQuery } from "@/data/done";
import { useWorkspacesQuery } from "@/data/workspaces";
import { archivedUi, archivedUiActions } from "@/stores/archivedUi";
import type { BulkResult } from "@/lib/done/bulk";
import { ArchivedRow } from "./ArchivedRow";
import { CleanupReport } from "./CleanupReport";

export function ArchivedDialog() {
  const snap = useSnapshot(archivedUi);
  const workspaceId = snap.workspaceId ?? undefined;
  const { data: sessions = [], isPending } = useArchivedQuery(
    workspaceId,
    snap.open
  );
  const { data: workspaces = [] } = useWorkspacesQuery();
  const where = workspaces.find((w) => w.id === workspaceId)?.name;

  return (
    <Dialog open={snap.open} onOpenChange={archivedUiActions.setOpen}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Archived{where ? ` · ${where}` : ""}</DialogTitle>
          <DialogDescription>
            Sessions marked done. They keep their history; unarchive one to
            bring it back to the sidebar.
          </DialogDescription>
        </DialogHeader>
        {snap.report && <CleanupReport report={snap.report as BulkResult} />}
        <div className="space-y-2">
          {isPending &&
            [0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-muted/40 h-14 animate-pulse rounded-xl"
              />
            ))}
          {!isPending && sessions.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Nothing archived yet.
            </p>
          )}
          {sessions.map((s) => (
            <ArchivedRow key={s.id} session={s} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
