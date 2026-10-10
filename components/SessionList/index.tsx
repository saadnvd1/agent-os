"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDocsWorkspace } from "@/data/lumifyhub/docs";
import { usePinSession } from "@/data/sessions";
import { useOrchestratorsQuery } from "@/data/orchestrators";
import { docsUiActions } from "@/stores/docsUi";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import type { OrchestratorOverview } from "@/lib/orchestrator/overview";
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

// Shared, so a query still loading doesn't hand rows a new array each render.
const NO_ORCHESTRATORS: OrchestratorOverview[] = [];

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
  const { data: orchestrators = NO_ORCHESTRATORS } = useOrchestratorsQuery();
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const addProject = useAddProject();
  const docsWorkspace = useDocsWorkspace(
    data.sessions.find((s) => s.id === activeSessionId)?.project_id
  );

  const orderedIds = useMemo(
    () =>
      flatten([
        ...shelves.orchestrators,
        ...shelves.pinned,
        ...shelves.needsYou,
        ...shelves.working,
        ...shelves.done,
      ]),
    [shelves]
  );

  // Rows read their handlers through the latest render, so the context only
  // changes when what rows draw does: a status push redraws the rows it
  // touched, not the whole list.
  const latest = useRef({ orderedIds, onSelect, onOpenInTab, mutations, pin });
  useLayoutEffect(() => {
    latest.current = { orderedIds, onSelect, onOpenInTab, mutations, pin };
  });
  const canOpenInTab = !!onOpenInTab;
  const handlers = useMemo(
    () => ({
      orderedIds: () => latest.current.orderedIds,
      onSelect: (id: string) => latest.current.onSelect(id),
      onOpenInTab: canOpenInTab
        ? (id: string) => latest.current.onOpenInTab?.(id)
        : undefined,
      onRename: (id: string, name: string) =>
        latest.current.mutations.handleRenameSession(id, name),
      onFork: (id: string) => latest.current.mutations.handleForkSession(id),
      onSummarize: (id: string) => latest.current.mutations.handleSummarize(id),
      onDelete: (id: string) =>
        latest.current.mutations.handleDeleteSession(id),
      onMoveToProject: (id: string, projectId: string) =>
        latest.current.mutations.handleMoveSessionToProject(id, projectId),
      onPin: (id: string, pinned: boolean) =>
        latest.current.pin.mutate({ id, pinned }),
    }),
    [canOpenInTab]
  );
  const workspaceNames = useMemo(
    () => new Map(data.workspaces.map((w) => [w.id, w.name])),
    [data.workspaces]
  );
  const rowContext: RowContextValue = useMemo(
    () => ({
      ...handlers,
      activeSessionId,
      summarizingSessionId: mutations.summarizingSessionId,
      projects: data.projects,
      projectNames: data.projectNames,
      workspaceNames,
      orchestrators,
      runningByWorkspace: data.runningByWorkspace,
      cardUrl: data.taskCardUrl,
    }),
    [
      handlers,
      activeSessionId,
      mutations.summarizingSessionId,
      data.projects,
      data.projectNames,
      workspaceNames,
      orchestrators,
      data.runningByWorkspace,
      data.taskCardUrl,
    ]
  );

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
