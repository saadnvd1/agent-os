"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { SessionPreviewPopover } from "@/components/SessionPreviewPopover";
import { ServerLogsModal } from "@/components/DevServers";
import {
  ProjectsSection,
  NewProjectDialog,
  ProjectSettingsDialog,
} from "@/components/Projects";
import { FolderPicker } from "@/components/FolderPicker";
import { SelectionToolbar } from "./SelectionToolbar";
import { SessionListHeader } from "./SessionListHeader";
import { GroupSection } from "./GroupSection";
import { KillAllConfirm } from "./KillAllConfirm";
import { useSessionListMutations } from "./hooks/useSessionListMutations";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ProjectSectionSkeleton } from "@/components/ui/skeleton";
import { Plus, FolderPlus, Loader2, AlertCircle } from "lucide-react";
import type { Session } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";
import { useViewport } from "@/hooks/useViewport";

// Data hooks
import { useSessionsQuery } from "@/data/sessions";
import { useProjectsQuery, useCreateProject } from "@/data/projects";
import { useDevServersQuery } from "@/data/dev-servers";

import type { SessionListProps } from "./SessionList.types";

export type { SessionListProps } from "./SessionList.types";

export function SessionList({
  activeSessionId,
  sessionStatuses,
  onSelect,
  onOpenInTab,
  onNewSessionInProject,
  onOpenTerminal,
  onStartDevServer,
  onCreateDevServer,
}: SessionListProps) {
  const { isMobile } = useViewport();

  // Fetch data directly with loading states
  const {
    data: sessionsData,
    isPending: isSessionsPending,
    isError: isSessionsError,
    error: sessionsError,
  } = useSessionsQuery();
  const {
    data: projects = [],
    isPending: isProjectsPending,
    isError: isProjectsError,
  } = useProjectsQuery();
  const { data: devServers = [] } = useDevServersQuery();

  // Combined loading state for initial load
  const isInitialLoading = isSessionsPending || isProjectsPending;
  const hasError = isSessionsError || isProjectsError;

  const sessions = sessionsData?.sessions ?? [];
  const groups = sessionsData?.groups ?? [];

  // All mutations via custom hook
  const mutations = useSessionListMutations({ onSelectSession: onSelect });

  // Project creation mutation for folder picker
  const createProject = useCreateProject();

  // Local UI state
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [editingProject, setEditingProject] =
    useState<ProjectWithDevServers | null>(null);
  const [showKillAllConfirm, setShowKillAllConfirm] = useState(false);
  const [hoveredSession, setHoveredSession] = useState<Session | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [logsServerId, setLogsServerId] = useState<string | null>(null);

  // Use projects if available
  const useProjectsView = projects.length > 0;

  // Flatten all session IDs for bulk operations
  const allSessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  // Separate workers from regular sessions
  const workersByConduct = useMemo(
    () =>
      sessions.reduce(
        (acc, session) => {
          if (session.conductor_session_id) {
            if (!acc[session.conductor_session_id])
              acc[session.conductor_session_id] = [];
            acc[session.conductor_session_id].push(session);
          }
          return acc;
        },
        {} as Record<string, Session[]>
      ),
    [sessions]
  );

  // Find server for logs modal
  const logsServer = logsServerId
    ? devServers.find((s) => s.id === logsServerId)
    : null;

  // Handle hover on session card (desktop only) with delay
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingHoverRef = useRef<{ session: Session; rect: DOMRect } | null>(
    null
  );

  const hoverHandlers = {
    onHoverStart: useCallback(
      (session: Session, rect: DOMRect) => {
        if (isMobile) return;
        // Clear any pending hover
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
        // Store pending hover data and start delay
        pendingHoverRef.current = { session, rect };
        hoverTimeoutRef.current = setTimeout(() => {
          if (pendingHoverRef.current) {
            setHoveredSession(pendingHoverRef.current.session);
            setHoverPosition({
              x: pendingHoverRef.current.rect.right,
              y: pendingHoverRef.current.rect.top,
            });
          }
        }, 400);
      },
      [isMobile]
    ),
    onHoverEnd: useCallback(() => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      pendingHoverRef.current = null;
      setHoveredSession(null);
    }, []),
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <SessionListHeader
        onNewProject={() => setShowNewProjectDialog(true)}
        onOpenProject={() => setShowFolderPicker(true)}
        onKillAll={() => setShowKillAllConfirm(true)}
      />

      {/* Kill All Confirmation */}
      {showKillAllConfirm && (
        <KillAllConfirm
          onCancel={() => setShowKillAllConfirm(false)}
          onComplete={() => setShowKillAllConfirm(false)}
        />
      )}

      {/* Selection Toolbar */}
      <SelectionToolbar
        allSessionIds={allSessionIds}
        onDeleteSessions={mutations.handleBulkDelete}
      />

      {/* Summarizing indicator */}
      {mutations.summarizingSessionId && (
        <div className="bg-primary/10 mx-4 mb-2 flex items-center gap-2 rounded-lg p-2 text-sm">
          <Loader2 className="text-primary h-4 w-4 animate-spin" />
          <span className="text-primary">Generating summary...</span>
        </div>
      )}

      {/* Session list */}
      <ScrollArea className="w-full flex-1">
        <div className="max-w-full space-y-0.5 px-1.5 py-1">
          {/* Loading state */}
          {isInitialLoading && <ProjectSectionSkeleton count={2} />}

          {/* Error state */}
          {hasError && !isInitialLoading && (
            <div className="flex flex-col items-center justify-center px-4 py-12">
              <AlertCircle className="text-destructive/50 mb-3 h-10 w-10" />
              <p className="text-destructive mb-2 text-sm">
                Failed to load sessions
              </p>
              <p className="text-muted-foreground mb-4 text-xs">
                {sessionsError?.message || "Unknown error"}
              </p>
              <Button
                variant="outline"
                onClick={mutations.handleRefresh}
                className="gap-2"
              >
                Retry
              </Button>
            </div>
          )}

          {/* Empty state */}
          {!isInitialLoading &&
            !hasError &&
            sessions.length === 0 &&
            projects.length <= 1 && (
              <div className="flex flex-col items-center justify-center px-4 py-12">
                <FolderPlus className="text-muted-foreground/50 mb-3 h-10 w-10" />
                <p className="text-muted-foreground mb-4 text-center text-sm">
                  Create a project to organize your sessions
                </p>
                <Button
                  onClick={() => setShowNewProjectDialog(true)}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  New Project
                </Button>
              </div>
            )}

          {/* Content - Projects view */}
          {!isInitialLoading && !hasError && useProjectsView && (
            <ProjectsSection
              projects={projects}
              sessions={sessions}
              groups={groups}
              activeSessionId={activeSessionId}
              sessionStatuses={sessionStatuses}
              summarizingSessionId={mutations.summarizingSessionId}
              devServers={devServers}
              onToggleProject={mutations.handleToggleProject}
              onEditProject={(projectId) => {
                const project = projects.find((p) => p.id === projectId);
                if (project) setEditingProject(project);
              }}
              onDeleteProject={mutations.handleDeleteProject}
              onRenameProject={mutations.handleRenameProject}
              onNewSession={onNewSessionInProject}
              onOpenTerminal={onOpenTerminal}
              onSelectSession={onSelect}
              onOpenSessionInTab={onOpenInTab}
              onMoveSession={mutations.handleMoveSessionToProject}
              onForkSession={mutations.handleForkSession}
              onSummarize={mutations.handleSummarize}
              onDeleteSession={mutations.handleDeleteSession}
              onRenameSession={mutations.handleRenameSession}
              onStartDevServer={onStartDevServer}
              onStopDevServer={mutations.handleStopDevServer}
              onRestartDevServer={mutations.handleRestartDevServer}
              onRemoveDevServer={mutations.handleRemoveDevServer}
              onViewDevServerLogs={setLogsServerId}
              onHoverStart={(session, rect) =>
                hoverHandlers.onHoverStart(session, rect)
              }
              onHoverEnd={hoverHandlers.onHoverEnd}
            />
          )}

          {/* Content - Group view (fallback when no projects) */}
          {!isInitialLoading &&
            !hasError &&
            !useProjectsView &&
            sessions.length > 0 && (
              <GroupSection
                groups={groups}
                sessions={sessions}
                activeSessionId={activeSessionId}
                sessionStatuses={sessionStatuses}
                summarizingSessionId={mutations.summarizingSessionId}
                workersByConduct={workersByConduct}
                onToggleGroup={mutations.handleToggleGroup}
                onCreateGroup={mutations.handleCreateGroup}
                onDeleteGroup={mutations.handleDeleteGroup}
                onSelectSession={onSelect}
                onForkSession={mutations.handleForkSession}
                onSummarize={mutations.handleSummarize}
                onDeleteSession={mutations.handleDeleteSession}
                onRenameSession={mutations.handleRenameSession}
                hoverHandlers={hoverHandlers}
              />
            )}
        </div>
      </ScrollArea>

      {/* Session Preview Popover (desktop only) */}
      {!isMobile && (
        <SessionPreviewPopover
          session={hoveredSession}
          status={
            hoveredSession
              ? sessionStatuses?.[hoveredSession.id]?.status
              : undefined
          }
          position={hoverPosition}
        />
      )}

      {/* Server Logs Modal */}
      {logsServer && (
        <ServerLogsModal
          serverId={logsServer.id}
          serverName={logsServer.name}
          onClose={() => setLogsServerId(null)}
        />
      )}

      {/* New Project Dialog */}
      <NewProjectDialog
        open={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
        onCreated={() => setShowNewProjectDialog(false)}
      />

      {/* Folder Picker for Open Project */}
      {showFolderPicker && (
        <FolderPicker
          initialPath="~"
          onClose={() => setShowFolderPicker(false)}
          onSelect={(path) => {
            // Derive project name from folder path
            const parts = path.split("/").filter(Boolean);
            const name = parts[parts.length - 1] || "project";

            createProject.mutate(
              {
                name,
                workingDirectory: path,
                agentType: "claude",
                defaultModel: "sonnet",
                devServers: [],
              },
              {
                onSuccess: () => setShowFolderPicker(false),
                onError: (err) => {
                  console.error("Failed to create project:", err);
                  setShowFolderPicker(false);
                },
              }
            );
          }}
        />
      )}

      {/* Project Settings Dialog */}
      <ProjectSettingsDialog
        project={editingProject}
        open={editingProject !== null}
        onClose={() => setEditingProject(null)}
        onSave={() => setEditingProject(null)}
      />
    </div>
  );
}
