"use client";

import { ChevronRight } from "lucide-react";
import { TmuxSessionRow } from "@/components/Hosts/TmuxSessionRow";
import { useDiscoveredTmuxQuery } from "@/data/hosts";
import { tmuxAttachActions } from "@/stores/tmuxAttach";
import { projectRow, type ProjectRowModel } from "@/lib/project-rows";
import type { TmuxSessionInfo } from "@/lib/status-detector";
import { cn } from "@/lib/utils";
import { useMemo, useCallback, useState } from "react";
import { useSnapshot } from "valtio";
import { ProjectCard } from "./ProjectCard";
import { SessionCard } from "@/components/SessionCard";
import { DevServerCard } from "@/components/DevServers/DevServerCard";
import { selectionStore, selectionActions } from "@/stores/sessionSelection";
import type { Session, Group, DevServer } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";

interface SessionStatus {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
}

interface ProjectsSectionProps {
  projects: ProjectWithDevServers[];
  sessions: Session[];
  groups: Group[]; // For backward compatibility with SessionCard move feature
  activeSessionId?: string;
  sessionStatuses?: Record<string, SessionStatus>;
  summarizingSessionId?: string | null;
  devServers?: DevServer[];
  onToggleProject?: (projectId: string, expanded: boolean) => void;
  onEditProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onRenameProject?: (projectId: string, newName: string) => void;
  onNewSession?: (projectId: string) => void;
  onOpenTerminal?: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenSessionInTab?: (sessionId: string) => void;
  onMoveSession?: (sessionId: string, projectId: string) => void;
  onForkSession?: (sessionId: string) => void;
  onSummarize?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
  onCreatePR?: (sessionId: string) => void;
  onStartDevServer?: (projectId: string) => void;
  onStopDevServer?: (serverId: string) => Promise<void>;
  onRestartDevServer?: (serverId: string) => Promise<void>;
  onRemoveDevServer?: (serverId: string) => Promise<void>;
  onViewDevServerLogs?: (serverId: string) => void;
  onHoverStart?: (session: Session, rect: DOMRect) => void;
  onHoverEnd?: () => void;
}

export function ProjectsSection({
  projects,
  sessions,
  groups,
  activeSessionId,
  sessionStatuses,
  summarizingSessionId,
  devServers = [],
  onToggleProject,
  onEditProject,
  onDeleteProject,
  onRenameProject,
  onNewSession,
  onOpenTerminal,
  onSelectSession,
  onOpenSessionInTab,
  onMoveSession,
  onForkSession,
  onSummarize,
  onDeleteSession,
  onRenameSession,
  onCreatePR,
  onStartDevServer,
  onStopDevServer,
  onRestartDevServer,
  onRemoveDevServer,
  onViewDevServerLogs,
  onHoverStart,
  onHoverEnd,
}: ProjectsSectionProps) {
  const [showIdle, setShowIdle] = useState(false);
  const { selectedIds } = useSnapshot(selectionStore);
  const isInSelectMode = selectedIds.size > 0;

  // Flatten all session IDs for range selection (respecting render order)
  const allSessionIds = useMemo(() => {
    const ids: string[] = [];
    for (const project of projects) {
      const projectSessions = sessions.filter(
        (s) =>
          !s.conductor_session_id &&
          (s.project_id || "uncategorized") === project.id
      );
      for (const session of projectSessions) {
        ids.push(session.id);
        // Include workers under this session
        const workers = sessions.filter(
          (s) => s.conductor_session_id === session.id
        );
        for (const worker of workers) {
          ids.push(worker.id);
        }
      }
    }
    return ids;
  }, [projects, sessions]);

  // Handler for toggling session selection
  const handleToggleSelect = useCallback(
    (sessionId: string, shiftKey: boolean) => {
      selectionActions.toggle(sessionId, shiftKey, allSessionIds);
    },
    [allSessionIds]
  );

  // Group sessions by project_id
  const sessionsByProject = sessions
    .filter((s) => !s.conductor_session_id) // Exclude workers
    .reduce(
      (acc, session) => {
        const projectId = session.project_id || "uncategorized";
        if (!acc[projectId]) acc[projectId] = [];
        acc[projectId].push(session);
        return acc;
      },
      {} as Record<string, Session[]>
    );

  // Group workers by conductor
  const workersByConduct = sessions.reduce(
    (acc, session) => {
      if (session.conductor_session_id) {
        if (!acc[session.conductor_session_id])
          acc[session.conductor_session_id] = [];
        acc[session.conductor_session_id].push(session);
      }
      return acc;
    },
    {} as Record<string, Session[]>
  );

  // Get running dev servers for a project (for ProjectCard badge)
  const getProjectRunningServers = (projectId: string): DevServer[] => {
    return devServers.filter(
      (ds) => ds.project_id === projectId && ds.status === "running"
    );
  };

  // Get all dev servers for a project
  const getProjectDevServers = (projectId: string): DevServer[] => {
    return devServers.filter((ds) => ds.project_id === projectId);
  };

  const { data: discovered } = useDiscoveredTmuxQuery();
  const tmuxByProject: Record<string, TmuxSessionInfo[]> = {};
  for (const t of discovered?.sessions ?? []) {
    if (t.projectId) (tmuxByProject[t.projectId] ??= []).push(t);
  }
  const rows: Record<string, ProjectRowModel> = {};
  for (const project of projects) {
    rows[project.id] = projectRow({
      sessions: sessionsByProject[project.id] || [],
      hasWorkers: (id) => (workersByConduct[id]?.length ?? 0) > 0,
      tmux: tmuxByProject[project.id] || [],
      statuses: sessionStatuses ?? {},
      activeSessionId,
    });
  }

  // As in mTerm, projects with nothing running fold behind one row.
  const visible = projects.filter(
    (p) =>
      !(p.is_uncategorized && rows[p.id].sessionCount === 0) &&
      (rows[p.id].running || rows[p.id].active)
  );
  const idle = projects.filter(
    (p) =>
      !(p.is_uncategorized && rows[p.id].sessionCount === 0) &&
      !visible.includes(p)
  );
  const shown = showIdle ? [...visible, ...idle] : visible;

  return (
    <div className="space-y-px">
      {shown.map((project) => {
        const projectSessions = sessionsByProject[project.id] || [];
        const row = rows[project.id];
        const projectTmux = tmuxByProject[project.id] || [];
        const runningServers = getProjectRunningServers(project.id);
        const projectDevServers = getProjectDevServers(project.id);

        return (
          <div key={project.id} className="space-y-0.5">
            {/* Project header */}
            <ProjectCard
              project={project}
              sessionCount={row.sessionCount}
              row={row}
              onOpenSingle={() => {
                const target = row.single;
                if (target?.kind === "session") onSelectSession(target.id);
                else if (target)
                  tmuxAttachActions.request(target.name, target.hostId);
              }}
              runningDevServers={runningServers}
              onToggleExpanded={(expanded) =>
                onToggleProject?.(project.id, expanded)
              }
              onEdit={
                !project.is_uncategorized && onEditProject
                  ? () => onEditProject(project.id)
                  : undefined
              }
              onNewSession={
                onNewSession ? () => onNewSession(project.id) : undefined
              }
              onOpenTerminal={
                onOpenTerminal ? () => onOpenTerminal(project.id) : undefined
              }
              onStartDevServer={
                !project.is_uncategorized && onStartDevServer
                  ? () => onStartDevServer(project.id)
                  : undefined
              }
              onDelete={
                !project.is_uncategorized && onDeleteProject
                  ? () => onDeleteProject(project.id)
                  : undefined
              }
              onRename={
                onRenameProject
                  ? (newName) => onRenameProject(project.id, newName)
                  : undefined
              }
            />

            {/* Project contents when expanded */}
            {project.expanded && (
              <div className="space-y-px pl-7">
                {/* Dev servers for this project */}
                {projectDevServers.length > 0 && (
                  <div className="space-y-px pb-0.5">
                    {projectDevServers.map((server) => (
                      <DevServerCard
                        key={server.id}
                        server={server}
                        onStart={
                          onRestartDevServer
                            ? (id) => onRestartDevServer(id)
                            : async () => {}
                        }
                        onStop={onStopDevServer || (async () => {})}
                        onRestart={onRestartDevServer || (async () => {})}
                        onRemove={onRemoveDevServer || (async () => {})}
                        onViewLogs={
                          onViewDevServerLogs
                            ? (id) => onViewDevServerLogs(id)
                            : () => {}
                        }
                      />
                    ))}
                  </div>
                )}

                {/* Project sessions */}
                {row.single || projectSessions.length === 0
                  ? null
                  : projectSessions.map((session) => {
                      const workers = workersByConduct[session.id] || [];
                      const hasWorkers = workers.length > 0;

                      return (
                        <div key={session.id} className="space-y-0.5">
                          <div className="flex items-center gap-1">
                            <div className="min-w-0 flex-1">
                              <SessionCard
                                session={session}
                                isActive={session.id === activeSessionId}
                                isSummarizing={
                                  summarizingSessionId === session.id
                                }
                                tmuxStatus={
                                  sessionStatuses?.[session.id]?.status
                                }
                                groups={groups}
                                projects={projects}
                                isSelected={selectedIds.has(session.id)}
                                isInSelectMode={isInSelectMode}
                                onToggleSelect={(shiftKey) =>
                                  handleToggleSelect(session.id, shiftKey)
                                }
                                onClick={() => onSelectSession(session.id)}
                                onOpenInTab={
                                  onOpenSessionInTab
                                    ? () => onOpenSessionInTab(session.id)
                                    : undefined
                                }
                                onMoveToProject={
                                  onMoveSession
                                    ? (projectId) =>
                                        onMoveSession(session.id, projectId)
                                    : undefined
                                }
                                onFork={
                                  onForkSession
                                    ? () => onForkSession(session.id)
                                    : undefined
                                }
                                onSummarize={
                                  onSummarize
                                    ? () => onSummarize(session.id)
                                    : undefined
                                }
                                onDelete={
                                  onDeleteSession
                                    ? () => onDeleteSession(session.id)
                                    : undefined
                                }
                                onRename={
                                  onRenameSession
                                    ? (newName) =>
                                        onRenameSession(session.id, newName)
                                    : undefined
                                }
                                onCreatePR={
                                  onCreatePR
                                    ? () => onCreatePR(session.id)
                                    : undefined
                                }
                                onHoverStart={
                                  onHoverStart
                                    ? (rect) => onHoverStart(session, rect)
                                    : undefined
                                }
                                onHoverEnd={onHoverEnd}
                              />
                            </div>
                            {/* Workers badge */}
                            {hasWorkers && (
                              <span className="bg-primary/20 text-primary flex-shrink-0 rounded-full px-1.5 py-0.5 text-xs">
                                {workers.length}
                              </span>
                            )}
                          </div>

                          {/* Nested workers */}
                          {hasWorkers && (
                            <div className="border-border/30 ml-3 space-y-px border-l pl-1.5">
                              {workers.map((worker) => (
                                <SessionCard
                                  key={worker.id}
                                  session={worker}
                                  isActive={worker.id === activeSessionId}
                                  tmuxStatus={
                                    sessionStatuses?.[worker.id]?.status
                                  }
                                  groups={groups}
                                  projects={projects}
                                  isSelected={selectedIds.has(worker.id)}
                                  isInSelectMode={isInSelectMode}
                                  onToggleSelect={(shiftKey) =>
                                    handleToggleSelect(worker.id, shiftKey)
                                  }
                                  onClick={() => onSelectSession(worker.id)}
                                  onOpenInTab={
                                    onOpenSessionInTab
                                      ? () => onOpenSessionInTab(worker.id)
                                      : undefined
                                  }
                                  onDelete={
                                    onDeleteSession
                                      ? () => onDeleteSession(worker.id)
                                      : undefined
                                  }
                                  onRename={
                                    onRenameSession
                                      ? (newName) =>
                                          onRenameSession(worker.id, newName)
                                      : undefined
                                  }
                                  onHoverStart={
                                    onHoverStart
                                      ? (rect) => onHoverStart(worker, rect)
                                      : undefined
                                  }
                                  onHoverEnd={onHoverEnd}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                {!row.single &&
                  projectTmux.map((t) => (
                    <TmuxSessionRow key={`${t.hostId}:${t.name}`} session={t} />
                  ))}
              </div>
            )}
          </div>
        );
      })}
      {idle.length > 0 && (
        <button
          type="button"
          onClick={() => setShowIdle(!showIdle)}
          className="text-muted-foreground/70 hover:text-muted-foreground flex min-h-11 w-full items-center gap-1.5 px-2.5 text-left text-xs md:min-h-7"
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 transition-transform",
              showIdle && "rotate-90"
            )}
          />
          {showIdle
            ? `Hide ${idle.length} not running`
            : `${idle.length} not running`}
        </button>
      )}
    </div>
  );
}
