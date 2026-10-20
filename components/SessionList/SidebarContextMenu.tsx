"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { FolderPlus } from "lucide-react";
import * as CM from "@/components/ui/context-menu";
import { WorkspaceNameDialog } from "@/components/Workspaces";
import { useCreateGroup } from "@/data/session-groups";

export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest("input, textarea, select, [contenteditable='true']")
  );
}

// Right-click anywhere in the session list (empty space or a group header)
// offers "New group". Rows keep their own menu, which wins because it has
// already handled the event; text fields keep the browser's.
export function SidebarContextMenu({
  workspaceId,
  children,
}: {
  workspaceId: string | null;
  children?: ReactNode;
}) {
  const createGroup = useCreateGroup();
  const [naming, setNaming] = useState(false);

  return (
    <>
      <CM.ContextMenu>
        <CM.ContextMenuTrigger
          asChild
          onContextMenuCapture={(e: MouseEvent) => {
            if (isEditableTarget(e.target)) e.stopPropagation();
          }}
        >
          {children}
        </CM.ContextMenuTrigger>
        <CM.ContextMenuContent className="w-44">
          <CM.ContextMenuItem
            className="min-h-11 md:min-h-8"
            onSelect={() => setNaming(true)}
          >
            <FolderPlus className="mr-2 h-3.5 w-3.5" />
            New group
          </CM.ContextMenuItem>
        </CM.ContextMenuContent>
      </CM.ContextMenu>
      <WorkspaceNameDialog
        open={naming}
        title="New group"
        submitLabel="Create"
        onSubmit={(name) => createGroup.mutate({ name, workspaceId })}
        onClose={() => setNaming(false)}
      />
    </>
  );
}
