"use client";

import { useSnapshot } from "valtio";
import { useTheme } from "next-themes";
import {
  Archive,
  Bell,
  Clock,
  Code,
  Gauge,
  LayoutGrid,
  ListTodo,
  MessageSquare,
  MessagesSquare,
  Moon,
  Plus,
  Smartphone,
  Sun,
  Workflow,
} from "lucide-react";
import type { Session } from "@/lib/db";
import type { PaletteCommand } from "@/lib/palette/registry";
import { useWorkspacesQuery } from "@/data/workspaces";
import { usePaletteCommands } from "@/hooks/usePaletteCommands";
import { archivedUiActions } from "@/stores/archivedUi";
import { busUiActions } from "@/stores/busUi";
import { devicesUiActions } from "@/stores/devicesUi";
import { orchestratorOpenActions } from "@/stores/orchestratorOpen";
import { sidebarUi, sidebarUiActions } from "@/stores/sidebarUi";
import { tasksUiActions } from "@/stores/tasksUi";
import { schedulesUiActions } from "@/stores/schedulesUi";
import { usageUiActions } from "@/stores/usageUi";

const LAST_THEME = "agentOS-last-theme-";

// The other mode, in the variant last used in it (dark purple stays purple).
function switchMode(current: string | undefined, to: "light" | "dark"): string {
  try {
    if (current && current !== "system")
      localStorage.setItem(
        LAST_THEME + (to === "dark" ? "light" : "dark"),
        current
      );
    return localStorage.getItem(LAST_THEME + to) ?? to;
  } catch {
    return to;
  }
}

// The palette's app-wide commands and its session search.
export function useAppCommands({
  sessions,
  onSelectSession,
  onNewSession,
  onSearchCode,
  onNotificationSettings,
}: {
  sessions: Session[];
  onSelectSession: (session: Session) => void;
  onNewSession: () => void;
  onSearchCode: () => void;
  onNotificationSettings?: () => void;
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { data: workspaces = [] } = useWorkspacesQuery();
  const { workspaceId } = useSnapshot(sidebarUi);
  const current = workspaces.find((w) => w.id === workspaceId) ?? null;
  const dark = resolvedTheme?.startsWith("dark") ?? false;

  const app: PaletteCommand[] = [
    {
      id: "app.new-session",
      title: "New session or chat",
      group: "Actions",
      keywords: ["create", "start"],
      icon: Plus,
      run: onNewSession,
    },
    {
      id: "app.new-task",
      title: "New task",
      group: "Actions",
      keywords: ["background", "pull request"],
      icon: ListTodo,
      run: tasksUiActions.openNew,
    },
    ...(current
      ? [
          {
            id: "app.orchestrator",
            title: `Open ${current.name}'s orchestrator`,
            group: "Actions",
            keywords: ["orchestrator", "workspace"],
            icon: Workflow,
            run: () => orchestratorOpenActions.request(current.id),
          },
        ]
      : []),
    {
      id: "app.search-code",
      title: "Search code",
      group: "Actions",
      keywords: ["grep", "ripgrep", "find in files"],
      icon: Code,
      run: onSearchCode,
    },
    {
      id: "app.usage",
      title: "Usage",
      group: "Go to",
      keywords: ["cost", "tokens", "limits", "spend", "window"],
      icon: Gauge,
      run: usageUiActions.open,
    },
    {
      id: "app.tasks",
      title: "Tasks",
      group: "Go to",
      icon: ListTodo,
      run: tasksUiActions.openPanel,
    },
    {
      id: "app.schedules",
      title: "Schedules",
      group: "Go to",
      keywords: ["cron", "timer", "recurring", "every day"],
      icon: Clock,
      run: () => schedulesUiActions.open(current?.id ?? null),
    },
    {
      id: "app.messages",
      title: "Messages",
      group: "Go to",
      keywords: ["bus", "peers"],
      icon: MessagesSquare,
      run: busUiActions.open,
    },
    {
      id: "app.archived",
      title: "Archived",
      group: "Go to",
      icon: Archive,
      run: () => archivedUiActions.open(),
    },
    {
      id: "app.devices",
      title: "Devices",
      group: "Go to",
      keywords: ["phone", "pair", "passkeys"],
      icon: Smartphone,
      run: devicesUiActions.open,
    },
    ...(onNotificationSettings
      ? [
          {
            id: "app.notifications",
            title: "Notification settings",
            group: "Settings",
            keywords: ["settings", "alerts"],
            icon: Bell,
            run: onNotificationSettings,
          },
        ]
      : []),
    {
      id: "app.theme",
      title: dark ? "Switch to light theme" : "Switch to dark theme",
      group: "Settings",
      keywords: ["theme", "dark mode", "light mode", "appearance"],
      icon: dark ? Sun : Moon,
      run: () => setTheme(switchMode(theme, dark ? "light" : "dark")),
    },
    ...[null, ...workspaces]
      .filter((w) => (w?.id ?? null) !== workspaceId)
      .map((w) => ({
        id: `workspace.${w?.id ?? "all"}`,
        title: `Switch to ${w?.name ?? "all workspaces"}`,
        group: "Workspaces",
        keywords: ["workspace"],
        icon: LayoutGrid,
        run: () => sidebarUiActions.setWorkspace(w?.id ?? null),
      })),
  ];
  usePaletteCommands("app", app);

  usePaletteCommands(
    "sessions",
    sessions
      .filter((s) => !s.archived_at && !s.conductor_session_id)
      .map((s) => ({
        id: `session.${s.id}`,
        title: s.name,
        group: "Sessions",
        keywords: [s.working_directory, s.branch_name ?? ""].filter(Boolean),
        icon: MessageSquare,
        run: () => onSelectSession(s),
      }))
  );
}
