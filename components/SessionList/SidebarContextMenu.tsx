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
// A group belongs to one workspace and only that workspace's sessions can
// join it. With a workspace selected the group goes there; viewing all of
// them, the choice is one entry per workspace (a group of no workspace could
// hold nothing).
export function groupTargets(
  workspaceId: string | null,
  workspaces: readonly { id: string; name: string }[]
): { id: string | null; label: string }[] {
  if (workspaceId || workspaces.length === 0)
    return [{ id: workspaceId, label: "New group" }];
  if (workspaces.length === 1)
    return [{ id: workspaces[0].id, label: "New group" }];
  return workspaces.map((w) => ({ id: w.id, label: `New group in ${w.name}` }));
}

export function SidebarContextMenu({
  workspaceId,
  workspaces = [],
  children,
}: {
  workspaceId: string | null;
  workspaces?: readonly { id: string; name: string }[];
  children?: ReactNode;
}) {
  const createGroup = useCreateGroup();
  const [naming, setNaming] = useState(false);
  const [target, setTarget] = useState<string | null>(workspaceId);

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
        <CM.ContextMenuContent className="w-52">
          {groupTargets(workspaceId, workspaces).map((t) => (
            <CM.ContextMenuItem
              key={t.id ?? "none"}
              className="min-h-11 md:min-h-8"
              onSelect={() => {
                setTarget(t.id);
                setNaming(true);
              }}
            >
              <FolderPlus className="mr-2 h-3.5 w-3.5" />
              <span className="truncate">{t.label}</span>
            </CM.ContextMenuItem>
          ))}
        </CM.ContextMenuContent>
      </CM.ContextMenu>
      <WorkspaceNameDialog
        open={naming}
        title="New group"
        submitLabel="Create"
        onSubmit={(name) => createGroup.mutate({ name, workspaceId: target })}
        onClose={() => setNaming(false)}
      />
    </>
  );
}
