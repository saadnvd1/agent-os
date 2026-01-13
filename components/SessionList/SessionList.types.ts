import type { Session, Group } from "@/lib/db";

export interface SessionStatus {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
}

export interface SessionListProps {
  activeSessionId?: string;
  sessionStatuses?: Record<string, SessionStatus>;
  onSelect: (sessionId: string) => void;
  onNewSessionInProject?: (projectId: string) => void;
  onStartDevServer?: (projectId: string) => void;
  onCreateDevServer?: (opts: {
    projectId: string;
    type: "node" | "docker";
    name: string;
    command: string;
    workingDirectory: string;
    ports?: number[];
  }) => Promise<void>;
}

export interface SessionHoverHandlers {
  onHoverStart: (session: Session, rect: DOMRect) => void;
  onHoverEnd: () => void;
}
