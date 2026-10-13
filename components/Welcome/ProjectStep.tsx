"use client";

import { FolderGit2, FolderOpen, FolderPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectsQuery } from "@/data/projects/queries";
import { cn } from "@/lib/utils";
import { addProjectActions, type AddProjectKind } from "@/stores/addProject";
import { welcomeUi, welcomeUiActions } from "@/stores/welcomeUi";
import { useSnapshot } from "valtio";

const WAYS: {
  kind: AddProjectKind;
  title: string;
  hint: string;
  icon: typeof FolderOpen;
}[] = [
  {
    kind: "folder",
    title: "Open a folder",
    hint: "A project already on this machine",
    icon: FolderOpen,
  },
  {
    kind: "clone",
    title: "Clone a repo",
    hint: "From a Git URL",
    icon: FolderGit2,
  },
  {
    kind: "name",
    title: "Start an empty project",
    hint: "A new folder with a name",
    icon: FolderPlus,
  },
];

/** Add the project the first session will open in, or pick one already there. */
export function ProjectStep() {
  const { projectId } = useSnapshot(welcomeUi);
  const { data: projects = [] } = useProjectsQuery();
  const own = projects.filter((p) => !p.is_uncategorized);

  const add = (kind: AddProjectKind) =>
    addProjectActions.show(kind, "local", (id) => {
      welcomeUiActions.setProject(id);
      welcomeUiActions.go("finish");
    });

  return (
    <div className="flex flex-col gap-3">
      {own.length > 0 && (
        <ul className="flex flex-col gap-2">
          {own.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  welcomeUiActions.setProject(p.id);
                  welcomeUiActions.go("finish");
                }}
                className={cn(
                  "bg-muted/40 hover:bg-accent flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                  projectId === p.id && "ring-primary/40 ring-2"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.name}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {p.working_directory}
                  </span>
                </span>
                {projectId === p.id && <Check className="size-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        {WAYS.map((w) => (
          <Button
            key={w.kind}
            variant="outline"
            className="h-auto min-h-11 justify-start gap-3 px-3 py-2.5 text-left"
            onClick={() => add(w.kind)}
          >
            <w.icon />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{w.title}</span>
              <span className="text-muted-foreground block text-xs font-normal">
                {w.hint}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
