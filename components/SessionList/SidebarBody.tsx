"use client";

import { AlertCircle, FolderPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShimmeringLoader } from "@/components/ui/skeleton";
import type { SidebarData } from "./useSidebarData";
import { SessionShelves } from "./SessionShelves";
import { SidebarExtras } from "./SidebarExtras";

function RowsSkeleton() {
  return (
    <div className="space-y-1 pt-3" aria-busy="true" aria-label="Loading">
      <ShimmeringLoader className="mx-2.5 mb-2 h-2.5 w-16" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex min-h-11 items-center gap-2.5 px-2.5">
          <ShimmeringLoader className="h-2 w-2 rounded-full" delayIndex={i} />
          <div className="flex-1 space-y-1.5">
            <ShimmeringLoader className="h-3.5 w-3/5" delayIndex={i} />
            <ShimmeringLoader className="h-2.5 w-1/4" delayIndex={i} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <p className="text-muted-foreground mb-4 text-sm">{text}</p>
      {action}
    </div>
  );
}

export function SidebarBody({
  data,
  onNewProject,
  devServerHandlers,
}: {
  data: SidebarData;
  onNewProject: () => void;
  devServerHandlers: React.ComponentProps<typeof SidebarExtras>["handlers"];
}) {
  const { shelves, ui } = data;
  if (data.isPending) return <RowsSkeleton />;
  if (data.error)
    return (
      <div className="flex flex-col items-center px-4 py-12">
        <AlertCircle className="text-destructive/50 mb-3 h-10 w-10" />
        <p className="text-destructive mb-2 text-sm">Failed to load sessions</p>
        <p className="text-muted-foreground mb-4 text-xs">
          {data.error.message}
        </p>
        <Button variant="outline" onClick={data.refetch}>
          Retry
        </Button>
      </div>
    );

  const count =
    shelves.pinned.length +
    shelves.needsYou.length +
    shelves.working.length +
    shelves.done.length;
  const noProjects = data.projects.every((p) => p.is_uncategorized);

  return (
    <>
      {count === 0 &&
        (ui.query ? (
          <Empty text={`No sessions match “${ui.query}”`} />
        ) : noProjects && data.sessions.length === 0 ? (
          <Empty
            text="Create a project to start your first session"
            action={
              <Button onClick={onNewProject} className="h-11 gap-2 md:h-9">
                <FolderPlus className="h-4 w-4" />
                New project
              </Button>
            }
          />
        ) : (
          <Empty
            text={
              data.project
                ? `Nothing in ${data.project.name} yet`
                : "No sessions here yet"
            }
            action={
              <p className="text-muted-foreground/70 flex items-center gap-1 text-xs">
                Start one from <Plus className="h-3 w-3" /> New
              </p>
            }
          />
        ))}
      <SessionShelves
        shelves={shelves}
        doneCollapsed={ui.doneCollapsed}
        donePages={ui.donePages}
      />
      <SidebarExtras
        projects={data.workspaceProjects}
        project={data.project}
        handlers={devServerHandlers}
      />
    </>
  );
}
