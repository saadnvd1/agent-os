"use client";

import { createContext, useContext } from "react";
import type { ProjectWithRepositories } from "@/lib/projects";
import type { OrchestratorOverview } from "@/lib/orchestrator/overview";

// What every row needs from the list, so shelves don't pass it along.
export interface RowContextValue {
  activeSessionId?: string;
  summarizingSessionId: string | null;
  projects: ProjectWithRepositories[];
  projectNames: Map<string, string>;
  workspaceNames: Map<string, string>;
  orchestrators: OrchestratorOverview[];
  runningByWorkspace: Map<string, number>;
  // Render order, for shift-click range selection.
  orderedIds: () => string[];
  cardUrl: (sessionId: string) => string | null | undefined;
  onSelect: (sessionId: string) => void;
  onOpenInTab?: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
  onFork: (sessionId: string) => void;
  onSummarize: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onMoveToProject: (sessionId: string, projectId: string) => void;
  onPin: (sessionId: string, pinned: boolean) => void;
}

const RowContext = createContext<RowContextValue | null>(null);

export const RowProvider = RowContext.Provider;

export function useRowContext(): RowContextValue {
  const value = useContext(RowContext);
  if (!value) throw new Error("useRowContext outside RowProvider");
  return value;
}
