import type { SessionNeed } from "@/lib/sidebar/shelves";

export interface SessionStatus {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
  title?: string;
  task?: string | null;
  asks?: number;
  need?: SessionNeed | null;
  unread?: boolean;
}

export interface SessionListProps {
  activeSessionId?: string;
  sessionStatuses?: Record<string, SessionStatus>;
  onSelect: (sessionId: string) => void;
  onOpenInTab?: (sessionId: string) => void;
  onNewSessionInProject?: (projectId: string) => void;
  onOpenTerminal?: (projectId: string) => void;
  onStartDevServer?: (projectId: string) => void;
  onCreateDevServer?: (opts: {
    projectId: string;
    type: "node" | "docker";
    name: string;
    command: string;
    workingDirectory: string;
    ports?: number[];
  }) => Promise<void>;
  pinControls?: {
    isPinned: boolean;
    onTogglePin: () => void;
  };
}
