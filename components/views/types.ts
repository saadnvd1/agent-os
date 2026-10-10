import type { SessionNeed } from "@/lib/sidebar/shelves";
import type { Session } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";
import type { NotificationSettings } from "@/lib/notifications";
import type { TabData } from "@/lib/panes";

export interface SessionStatus {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
  title?: string;
  task?: string | null;
  asks?: number;
  need?: SessionNeed | null;
  unread?: boolean;
  claudeSessionId?: string | null;
  // From a program's OSC 7501 report: untrusted, rendered as plain text.
  detail?: string | null;
  progress?: number | null;
}

export interface ViewProps {
  sessions: Session[];
  projects: ProjectWithDevServers[];
  sessionStatuses: Record<string, SessionStatus>;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activeSession: Session | undefined;
  focusedActiveTab: TabData | null;

  // Dialogs
  showQuickSwitcher: boolean;
  setShowQuickSwitcher: (show: boolean) => void;

  // Notification settings (changed in Settings > Notifications)
  notificationSettings: NotificationSettings;

  // Handlers
  attachToSession: (session: Session) => void;
  openSessionInNewTab: (session: Session) => void;
  handleNewSessionInProject: (projectId: string) => void;
  handleOpenTerminal: (projectId: string) => void;

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
