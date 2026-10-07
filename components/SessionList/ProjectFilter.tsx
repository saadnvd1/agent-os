"use client";

import { Check, ChevronDown, Folder } from "lucide-react";
import * as DM from "@/components/ui/dropdown-menu";
import type { ProjectWithRepositories } from "@/lib/projects";
import { sidebarUiActions } from "@/stores/sidebarUi";
import { cn } from "@/lib/utils";
import { ProjectActions, type ProjectActionHandlers } from "./ProjectActions";

// "All projects", or one: narrows the list, is remembered, and carries
// the chosen project's own actions.
export function ProjectFilter({
  projects,
  current,
  handlers,
}: {
  projects: ProjectWithRepositories[];
  current: ProjectWithRepositories | null;
  handlers: ProjectActionHandlers;
}) {
  const choices = [null, ...projects];
  return (
    <DM.DropdownMenu>
      <DM.DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "bg-card flex min-h-11 max-w-[8.5rem] shrink-0 items-center gap-1 rounded-xl px-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.08)] md:min-h-9",
            current && "text-primary"
          )}
        >
          <span className="truncate">{current?.name ?? "All projects"}</span>
          <ChevronDown className="text-muted-foreground h-3 w-3 shrink-0" />
        </button>
      </DM.DropdownMenuTrigger>
      <DM.DropdownMenuContent
        align="end"
        className="max-h-[70vh] w-60 overflow-y-auto"
      >
        {current && (
          <>
            <DM.DropdownMenuLabel className="text-muted-foreground truncate text-xs font-normal">
              {current.name}
            </DM.DropdownMenuLabel>
            <ProjectActions project={current} handlers={handlers} />
            <DM.DropdownMenuSeparator />
          </>
        )}
        <DM.DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Show
        </DM.DropdownMenuLabel>
        {choices.map((p) => (
          <DM.DropdownMenuItem
            key={p?.id ?? "all"}
            onClick={() => sidebarUiActions.setProject(p?.id ?? null)}
          >
            <Folder className="mr-2 h-3.5 w-3.5" />
            <span className="flex-1 truncate">{p?.name ?? "All projects"}</span>
            {(current?.id ?? null) === (p?.id ?? null) && (
              <Check className="text-primary h-3.5 w-3.5" />
            )}
          </DM.DropdownMenuItem>
        ))}
      </DM.DropdownMenuContent>
    </DM.DropdownMenu>
  );
}
