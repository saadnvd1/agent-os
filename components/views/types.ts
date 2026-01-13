import type { Session, Group } from "@/lib/db";
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
  handleToggleGroup: (path: string, expanded: boolean) => Promise<void>;
  handleCreateGroup: (name: string, parentPath?: string) => Promise<void>;
  handleDeleteGroup: (path: string) => Promise<void>;
  handleMoveSession: (sessionId: string, groupPath: string) => Promise<void>;
  handleForkSession: (sessionId: string) => Promise<void>;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleRenameSession: (sessionId: string, newName: string) => Promise<void>;
  handleCreatePR: (sessionId: string) => Promise<void>;

  // Pane
  renderPane: (paneId: string) => React.ReactNode;
}
