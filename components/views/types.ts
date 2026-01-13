import type { Session, Group, DevServer, Project } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";
import type { NotificationSettings } from "@/lib/notifications";
import type { TabData } from "@/lib/panes";

export interface SessionStatus {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
  claudeSessionId?: string | null;
}

export interface ViewProps {
  sessions: Session[];
  groups: Group[];
  projects: ProjectWithDevServers[];
  sessionStatuses: Record<string, SessionStatus>;
  summarizingSessionId: string | null;
  devServers: DevServer[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activeSession: Session | undefined;
  focusedActiveTab: TabData | null;
  copiedSessionId: boolean;
  setCopiedSessionId: (copied: boolean) => void;

  // Dialogs
  showNewSessionDialog: boolean;
  setShowNewSessionDialog: (show: boolean) => void;
  newSessionProjectId: string | null;
  showNewProjectDialog: boolean;
  setShowNewProjectDialog: (show: boolean) => void;
  showProjectSettings: ProjectWithDevServers | null;
  setShowProjectSettings: (project: ProjectWithDevServers | null) => void;
  showNotificationSettings: boolean;
  setShowNotificationSettings: (show: boolean) => void;
  showQuickSwitcher: boolean;
  setShowQuickSwitcher: (show: boolean) => void;

  // Notification settings
  notificationSettings: NotificationSettings;
  permissionGranted: boolean;
  updateSettings: (settings: Partial<NotificationSettings>) => void;
  requestPermission: () => Promise<boolean>;

  // Handlers
  attachToSession: (session: Session) => void;
  fetchSessions: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  handleToggleGroup: (path: string, expanded: boolean) => Promise<void>;
  handleCreateGroup: (name: string, parentPath?: string) => Promise<void>;
  handleDeleteGroup: (path: string) => Promise<void>;
  handleMoveSession: (sessionId: string, groupPath: string) => Promise<void>;
  handleForkSession: (sessionId: string) => Promise<void>;
  handleSummarize: (sessionId: string) => Promise<void>;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleRenameSession: (sessionId: string, newName: string) => Promise<void>;
  handleCreatePR: (sessionId: string) => Promise<void>;

  // Project handlers
  handleToggleProject: (projectId: string, expanded: boolean) => Promise<void>;
  handleEditProject: (projectId: string) => void;
  handleDeleteProject: (projectId: string) => Promise<void>;
  handleRenameProject: (projectId: string, newName: string) => Promise<void>;
  handleMoveSessionToProject: (sessionId: string, projectId: string) => Promise<void>;
  handleNewSessionInProject: (projectId: string) => void;

  // Dev server handlers
  handleStartDevServer: (projectId: string) => void;
  handleStopDevServer: (serverId: string) => Promise<void>;
  handleRestartDevServer: (serverId: string) => Promise<void>;
  handleRemoveDevServer: (serverId: string) => Promise<void>;
  handleCreateDevServer: (opts: {
    projectId: string;
    type: "node" | "docker";
    name: string;
    command: string;
    workingDirectory: string;
    ports?: number[];
  }) => Promise<void>;
  startDevServerProject: ProjectWithDevServers | null;
  setStartDevServerProjectId: (id: string | null) => void;

  // Pane
  renderPane: (paneId: string) => React.ReactNode;
}
