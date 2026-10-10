"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import type { Workspace } from "@/lib/db";
import { useWorkspacesQuery } from "@/data/workspaces";
import { sidebarUi, sidebarUiActions } from "@/stores/sidebarUi";

const NONE: Workspace[] = [];

// The workspace picked in the sidebar, read the same way everywhere: one
// remembered but since deleted (or not loaded yet) is "all".
export function useSelectedWorkspace() {
  const ui = useSnapshot(sidebarUi);
  useEffect(() => sidebarUiActions.hydrate(), []);
  const { data: workspaces = NONE } = useWorkspacesQuery();
  const workspace = workspaces.find((w) => w.id === ui.workspaceId) ?? null;
  return { workspaces, workspace };
}
