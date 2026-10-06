"use client";

import { useState } from "react";
import { ChevronRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Workspace } from "@/lib/db";
import { useDeleteWorkspace, useUpdateWorkspace } from "@/data/workspaces";
import { WorkspaceNameDialog } from "./WorkspaceNameDialog";
import { cn } from "@/lib/utils";

interface WorkspaceHeaderProps {
  workspace: Workspace;
  needsYou: number;
}

export function WorkspaceHeader({ workspace, needsYou }: WorkspaceHeaderProps) {
  const update = useUpdateWorkspace();
  const remove = useDeleteWorkspace();
  const [renaming, setRenaming] = useState(false);

  return (
    <>
      <div
        onClick={() =>
          update.mutate({ id: workspace.id, collapsed: !workspace.collapsed })
        }
        className="group flex min-h-11 cursor-pointer items-center gap-1.5 px-2 pt-4 pb-1 md:min-h-9"
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground h-3.5 w-3.5 shrink-0 transition-transform",
            !workspace.collapsed && "rotate-90"
          )}
        />
        <span className="text-foreground min-w-0 truncate text-[13px] font-semibold tracking-tight">
          {workspace.name}
        </span>
        {needsYou > 0 && (
          <span className="text-[11px] font-medium text-amber-600 tabular-nums dark:text-amber-400">
            {needsYou} need{needsYou === 1 ? "s" : ""} you
          </span>
        )}
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 md:hidden md:h-6 md:w-6 md:group-hover:inline-flex"
              aria-label="Workspace actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil className="mr-2 h-3 w-3" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => remove.mutate(workspace.id)}
              className="text-red-500 focus:text-red-500"
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Delete (keeps projects)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <WorkspaceNameDialog
        open={renaming}
        title="Rename workspace"
        initialName={workspace.name}
        submitLabel="Rename"
        onSubmit={(name) => update.mutate({ id: workspace.id, name })}
        onClose={() => setRenaming(false)}
      />
    </>
  );
}
