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
  projectCount: number;
  needsYou: number;
}

// A quiet section label, as in mTerm: the projects under it are the rows.
export function WorkspaceHeader({
  workspace,
  projectCount,
  needsYou,
}: WorkspaceHeaderProps) {
  const update = useUpdateWorkspace();
  const remove = useDeleteWorkspace();
  const [renaming, setRenaming] = useState(false);

  return (
    <>
      <div
        onClick={() =>
          update.mutate({ id: workspace.id, collapsed: !workspace.collapsed })
        }
        className="group relative flex min-h-11 cursor-pointer items-center gap-1.5 px-2 pt-3 md:min-h-8"
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground/60 h-3 w-3 shrink-0 transition-transform",
            !workspace.collapsed && "rotate-90"
          )}
        />
        <span className="label-mono text-muted-foreground group-hover:text-foreground truncate transition-colors">
          {workspace.name}
        </span>
        {needsYou > 0 ? (
          <span className="font-mono text-[11px] text-amber-600 tabular-nums dark:text-amber-400">
            {needsYou}
          </span>
        ) : (
          <span className="text-muted-foreground/50 font-mono text-[11px] tabular-nums">
            {projectCount}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="bg-sidebar-background hover:bg-accent absolute right-1 bottom-0 h-7 w-7 md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100 md:data-[state=open]:opacity-100"
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
