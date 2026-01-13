"use client";

import { ProjectCard } from "./ProjectCard";
import { SessionCard } from "@/components/SessionCard";
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
  onSelectSession: (sessionId: string) => void;
  onMoveSession?: (sessionId: string, projectId: string) => void;
  onForkSession?: (sessionId: string) => void;
  onSummarize?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
  onCreatePR?: (sessionId: string) => void;
  onStartDevServer?: (sessionId: string) => void;
  onStartProjectDevServers?: (projectId: string) => void;
  onStopProjectDevServers?: (projectId: string) => void;
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
  onSelectSession,
  onMoveSession,
  onForkSession,
  onSummarize,
  onDeleteSession,
  onRenameSession,
  onCreatePR,
  onStartDevServer,
  onStartProjectDevServers,
  onStopProjectDevServers,
  onHoverStart,
  onHoverEnd,
}: ProjectsSectionProps) {
  // Group sessions by project_id
  const sessionsByProject = sessions
    .filter((s) => !s.conductor_session_id) // Exclude workers
    .reduce((acc, session) => {
      const projectId = session.project_id || "uncategorized";
      if (!acc[projectId]) acc[projectId] = [];
      acc[projectId].push(session);
      return acc;
    }, {} as Record<string, Session[]>);

  // Group workers by conductor
  const workersByConduct = sessions.reduce((acc, session) => {
    if (session.conductor_session_id) {
      if (!acc[session.conductor_session_id]) acc[session.conductor_session_id] = [];
      acc[session.conductor_session_id].push(session);
    }
    return acc;
  }, {} as Record<string, Session[]>);

  // Get running dev servers for a project
  const getProjectRunningServers = (projectId: string): DevServer[] => {
    const projectSessions = sessionsByProject[projectId] || [];
    const sessionIds = new Set(projectSessions.map((s) => s.id));
    return devServers.filter(
      (ds) => sessionIds.has(ds.session_id) && ds.status === "running"
    );
  };

  return (
    <div className="space-y-1">
      {projects.map((project) => {
        const projectSessions = sessionsByProject[project.id] || [];
        const runningServers = getProjectRunningServers(project.id);

        return (
          <div key={project.id} className="space-y-0.5">
            {/* Project header */}
            <ProjectCard
              project={project}
              sessionCount={projectSessions.length}
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
              onStartDevServers={
                !project.is_uncategorized &&
                project.devServers.length > 0 &&
                runningServers.length === 0 &&
                onStartProjectDevServers
                  ? () => onStartProjectDevServers(project.id)
                  : undefined
              }
              onStopDevServers={
                runningServers.length > 0 && onStopProjectDevServers
                  ? () => onStopProjectDevServers(project.id)
                  : undefined
              }
              onDelete={
                !project.is_uncategorized && onDeleteProject
                  ? () => onDeleteProject(project.id)
                  : undefined
              }
              onRename={
                !project.is_uncategorized && onRenameProject
                  ? (newName) => onRenameProject(project.id, newName)
                  : undefined
              }
            />

            {/* Project sessions */}
            {project.expanded && (
              <div className="ml-4 pl-2 border-l border-border/30 space-y-0.5">
                {projectSessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 px-2">
                    No sessions yet
                  </p>
                ) : (
                  projectSessions.map((session) => {
                    const workers = workersByConduct[session.id] || [];
                    const hasWorkers = workers.length > 0;

                    return (
                      <div key={session.id} className="space-y-0.5">
                        <div className="flex items-center gap-1">
                          <div className="flex-1 min-w-0">
                            <SessionCard
                              session={session}
                              isActive={session.id === activeSessionId}
                              isSummarizing={summarizingSessionId === session.id}
                              tmuxStatus={sessionStatuses?.[session.id]?.status}
                              groups={groups}
                              projects={projects}
                              onClick={() => onSelectSession(session.id)}
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
                              onStartDevServer={
                                onStartDevServer
                                  ? () => onStartDevServer(session.id)
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
                            <span className="flex-shrink-0 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                              {workers.length}
                            </span>
                          )}
                        </div>

                        {/* Nested workers */}
                        {hasWorkers && (
                          <div className="ml-4 pl-2 border-l border-border/30 space-y-0.5">
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
                                onClick={() => onSelectSession(worker.id)}
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
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
