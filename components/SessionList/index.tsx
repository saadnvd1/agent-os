"use client";

import { useState, useMemo } from "react";
import { SessionPreviewPopover } from "@/components/SessionPreviewPopover";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { ServerLogsModal } from "@/components/DevServers";
import { ProjectsSection, NewProjectDialog, ProjectSettingsDialog } from "@/components/Projects";
import { SelectionToolbar } from "./SelectionToolbar";
import { SessionListHeader } from "./SessionListHeader";
import { GroupSection } from "./GroupSection";
import { KillAllConfirm } from "./KillAllConfirm";
import { useSessionListMutations } from "./hooks/useSessionListMutations";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Plus, FolderPlus, Loader2 } from "lucide-react";
import type { Session } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";
import { useViewport } from "@/hooks/useViewport";

// Data hooks
import { useSessionsQuery } from "@/data/sessions";
import { useProjectsQuery } from "@/data/projects";
import { useDevServersQuery } from "@/data/dev-servers";

import type { SessionListProps } from "./SessionList.types";

export type { SessionListProps } from "./SessionList.types";

export function SessionList({
  activeSessionId,
  sessionStatuses,
  onSelect,
  onOpenInTab,
  onNewSessionInProject,
  onStartDevServer,
  onCreateDevServer,
}: SessionListProps) {
  const { isMobile } = useViewport();

  // Fetch data directly
  const { data: sessionsData } = useSessionsQuery();
  const { data: projects = [] } = useProjectsQuery();
  const { data: devServers = [] } = useDevServersQuery();

  const sessions = sessionsData?.sessions ?? [];
  const groups = sessionsData?.groups ?? [];

  // All mutations via custom hook
  const mutations = useSessionListMutations({ onSelectSession: onSelect });

  // Local UI state
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectWithDevServers | null>(null);
  const [showKillAllConfirm, setShowKillAllConfirm] = useState(false);
  const [hoveredSession, setHoveredSession] = useState<Session | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [logsServerId, setLogsServerId] = useState<string | null>(null);

  // Use projects if available
  const useProjectsView = projects.length > 0;

  // Flatten all session IDs for bulk operations
  const allSessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  // Separate workers from regular sessions
  const workersByConduct = useMemo(() => sessions.reduce((acc, session) => {
    if (session.conductor_session_id) {
      if (!acc[session.conductor_session_id]) acc[session.conductor_session_id] = [];
      acc[session.conductor_session_id].push(session);
    }
    return acc;
  }, {} as Record<string, Session[]>), [sessions]);

  // Find server for logs modal
  const logsServer = logsServerId ? devServers.find((s) => s.id === logsServerId) : null;

  // Handle hover on session card (desktop only)
  const hoverHandlers = {
    onHoverStart: (session: Session, rect: DOMRect) => {
      if (isMobile) return;
      setHoveredSession(session);
      setHoverPosition({ x: rect.right, y: rect.top });
    },
    onHoverEnd: () => setHoveredSession(null),
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <SessionListHeader
          onRefresh={mutations.handleRefresh}
          onNewSession={() => setShowNewDialog(true)}
          onNewProject={() => setShowNewProjectDialog(true)}
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
        <SelectionToolbar allSessionIds={allSessionIds} onDeleteSessions={mutations.handleBulkDelete} />

        {/* Summarizing indicator */}
        {mutations.summarizingSessionId && (
          <div className="mx-4 mb-2 p-2 rounded-lg bg-primary/10 flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-primary">Generating summary...</span>
          </div>
        )}

        {/* Session list */}
        <ScrollArea className="flex-1 w-full">
          <div className="p-2 space-y-1 max-w-full">
            {sessions.length === 0 && projects.length <= 1 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <FolderPlus className="w-10 h-10 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground text-sm mb-4 text-center">Create a project to organize your sessions</p>
                <Button onClick={() => setShowNewProjectDialog(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  New Project
                </Button>
              </div>
            ) : useProjectsView ? (
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
                onHoverStart={(session, rect) => hoverHandlers.onHoverStart(session, rect)}
                onHoverEnd={hoverHandlers.onHoverEnd}
              />
            ) : (
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

        {/* New Session Dialog */}
        <NewSessionDialog
          open={showNewDialog}
          projects={projects}
          onClose={() => setShowNewDialog(false)}
          onCreated={(id) => {
            setShowNewDialog(false);
            onSelect(id);
          }}
        />

        {/* Session Preview Popover (desktop only) */}
        {!isMobile && (
          <SessionPreviewPopover
            session={hoveredSession}
            status={hoveredSession ? sessionStatuses?.[hoveredSession.id]?.status : undefined}
            position={hoverPosition}
          />
        )}

        {/* Server Logs Modal */}
        {logsServer && <ServerLogsModal serverId={logsServer.id} serverName={logsServer.name} onClose={() => setLogsServerId(null)} />}

        {/* New Project Dialog */}
        <NewProjectDialog
          open={showNewProjectDialog}
          onClose={() => setShowNewProjectDialog(false)}
          onCreated={() => setShowNewProjectDialog(false)}
        />

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
