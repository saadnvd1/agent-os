"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Workspace } from "@/lib/db";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";

const KEY = "agentOS-settings-workspace";

const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

// Which workspace Settings > Workspaces shows: the one picked here last,
// else the sidebar's, else the first. A remembered one since deleted falls
// through.
export function useSettingsWorkspace(workspaces: Workspace[]) {
  const { workspace: sidebar } = useSelectedWorkspace();
  const picked = useSyncExternalStore(subscribe, read, () => null);
  const choose = useCallback((id: string) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // Not remembered; the choice still holds for this visit.
    }
    listeners.forEach((fn) => fn());
  }, []);
  const current =
    workspaces.find((w) => w.id === picked) ??
    workspaces.find((w) => w.id === sidebar?.id) ??
    workspaces[0];
  return { current, choose };
}
