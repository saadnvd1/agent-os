"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDocsWorkspace } from "@/data/lumifyhub/docs";
import { usePinSession } from "@/data/sessions";
import { useOrchestratorsQuery } from "@/data/orchestrators";
import { docsUiActions } from "@/stores/docsUi";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { useSessionListMutations } from "./hooks/useSessionListMutations";
import { useBulkDelete } from "./hooks/useBulkDelete";
import { useSidebarData } from "./useSidebarData";
import { RowProvider, type RowContextValue } from "./RowContext";
import { SidebarHeader } from "./SidebarHeader";
import { useAddProject } from "@/components/Projects/AddProject/useAddProject";
import { SidebarSearch } from "./SidebarSearch";
import { ProjectFilter } from "./ProjectFilter";
import { SelectionToolbar } from "./SelectionToolbar";
import { SidebarBody } from "./SidebarBody";
import { SidebarDialogs, type SidebarDialog } from "./SidebarDialogs";
import type { SessionListProps } from "./SessionList.types";

export type { SessionListProps } from "./SessionList.types";

const flatten = (rows: SidebarRow[]): string[] =>
  rows.flatMap((r) => [r.session.id, ...flatten(r.workers)]);

// One flat list of the workspace's sessions, on shelves: Pinned, Needs
// you, Working, Done.
export function SessionList({
  activeSessionId,
  sessionStatuses,
  onSelect,
  onOpenInTab,
  onNewSessionInProject,
  onOpenTerminal,
  onStartDevServer,
  pinControls,
}: SessionListProps) {
  const data = useSidebarData(sessionStatuses);
  const { shelves, ui, project } = data;
  const mutations = useSessionListMutations({ onSelectSession: onSelect });
  const bulkDelete = useBulkDelete();
  const pin = usePinSession();
  const { data: orchestrators = [] } = useOrchestratorsQuery();
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const addProject = useAddProject();
  const docsWorkspace = useDocsWorkspace(
    data.sessions.find((s) => s.id === activeSessionId)?.project_id
  );

  const orderedIds = useMemo(
    () =>
      flatten([
        ...shelves.pinned,
        ...shelves.needsYou,
        ...shelves.working,
        ...shelves.done,
      ]),
    [shelves]
  );

  const rowContext: RowContextValue = {
    activeSessionId,
    summarizingSessionId: mutations.summarizingSessionId,
    projects: data.projects,
    projectNames: data.projectNames,
    workspaceNames: new Map(data.workspaces.map((w) => [w.id, w.name])),
    orchestrators,
    runningByWorkspace: data.runningByWorkspace,
    orderedIds,
    cardUrl: data.taskCardUrl,
    onSelect,
    onOpenInTab,
    onRename: mutations.handleRenameSession,
    onFork: mutations.handleForkSession,
    onSummarize: mutations.handleSummarize,
    onDelete: mutations.handleDeleteSession,
    onMoveToProject: mutations.handleMoveSessionToProject,
    onPin: (id, pinned) => pin.mutate({ id, pinned }),
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SidebarHeader
        workspaces={data.workspaces}
        workspace={data.workspace}
        onNewSession={() => onNewSessionInProject?.(project?.id ?? "")}
        onAddProject={addProject}
        onKillAll={() => setDialog({ kind: "killAll" })}
        onManageHosts={() => setDialog({ kind: "hosts" })}
        onOpenDocs={
          docsWorkspace ? () => docsUiActions.open(docsWorkspace.id) : undefined
        }
        pinControls={pinControls}
      />
      <div className="flex gap-2 px-3 pb-2">
        <SidebarSearch query={ui.query} />
        <ProjectFilter
          projects={data.workspaceProjects}
          current={project}
          handlers={{
            onNewSession: onNewSessionInProject,
            onOpenTerminal,
            onStartDevServer,
            onEdit: (p) => setDialog({ kind: "settings", project: p }),
            onRename: (p) => setDialog({ kind: "renameProject", project: p }),
            onDelete: mutations.handleDeleteProject,
          }}
        />
      </div>

      <SelectionToolbar
        allSessionIds={orderedIds}
        onDeleteSessions={bulkDelete}
      />

      {mutations.summarizingSessionId && (
        <div className="bg-primary/10 mx-3 mb-2 flex items-center gap-2 rounded-lg p-2 text-sm">
          <Loader2 className="text-primary h-4 w-4 animate-spin" />
          <span className="text-primary">Generating summary...</span>
        </div>
      )}

      <ScrollArea className="w-full flex-1">
        <div className="max-w-full px-1.5 pb-6">
          <RowProvider value={rowContext}>
            <SidebarBody
              data={data}
              onNewProject={addProject}
              devServerHandlers={{
                onStop: mutations.handleStopDevServer,
                onRestart: mutations.handleRestartDevServer,
                onRemove: mutations.handleRemoveDevServer,
                onViewLogs: (serverId) => setDialog({ kind: "logs", serverId }),
              }}
            />
          </RowProvider>
        </div>
      </ScrollArea>

      <SidebarDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        onRenameProject={mutations.handleRenameProject}
      />
    </div>
  );
}
