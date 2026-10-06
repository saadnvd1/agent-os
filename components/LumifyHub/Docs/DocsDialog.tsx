"use client";

import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspacesQuery } from "@/data/workspaces";
import { docsUi, docsUiActions } from "@/stores/docsUi";
import { DocsList } from "./DocsList";
import { DocReader } from "./DocReader";

export function DocsDialog() {
  const { workspaceId, pageId } = useSnapshot(docsUi);
  const { data: workspaces = [] } = useWorkspacesQuery();
  const workspace = workspaces.find((w) => w.id === workspaceId);

  return (
    <Dialog
      open={!!workspaceId}
      onOpenChange={(open) => !open && docsUiActions.close()}
    >
      <DialogContent className="flex h-[85vh] max-w-2xl flex-col sm:max-w-2xl [&>*]:min-w-0">
        <DialogHeader className={pageId ? "sr-only" : undefined}>
          <DialogTitle>Docs</DialogTitle>
          <DialogDescription>
            Pages in {workspace?.lh_workspace_name ?? "LumifyHub"}. Read them
            here, edit them in LumifyHub.
          </DialogDescription>
        </DialogHeader>
        {workspaceId &&
          (pageId ? (
            <DocReader workspaceId={workspaceId} pageId={pageId} />
          ) : (
            <DocsList workspaceId={workspaceId} />
          ))}
      </DialogContent>
    </Dialog>
  );
}
