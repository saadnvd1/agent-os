import type { Session } from "@/lib/db";
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
  projects: ProjectWithDevServers[];
  sessionStatuses: Record<string, SessionStatus>;
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
  openSessionInNewTab: (session: Session) => void;
  handleNewSessionInProject: (projectId: string) => void;
  handleOpenTerminal: (projectId: string) => void;
  handleSessionCreated: (sessionId: string) => Promise<void>;
  handleCreateProject: (
    name: string,
    workingDirectory: string,
    agentType?: string
  ) => Promise<string | null>;

  // Dev server (for StartServerDialog)
  handleStartDevServer: (projectId: string) => void;
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
