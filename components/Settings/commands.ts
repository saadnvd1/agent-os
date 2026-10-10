import {
  Bell,
  Clock,
  GitMerge,
  LayoutGrid,
  Settings,
  Smartphone,
} from "lucide-react";
import type { PaletteCommand } from "@/lib/palette/registry";
import { schedulesUiActions } from "@/stores/schedulesUi";
import { settingsUiActions } from "@/stores/settingsUi";

/**
 * ⌘K's way into Settings: "Settings" itself, and the names each setting had
 * before it moved there (Devices, Notification settings, Schedules...), so
 * they still find it. `workspaceId` scopes Schedules, as the sidebar does.
 */
export function settingsCommands(workspaceId: string | null): PaletteCommand[] {
  const group = "Settings";
  return [
    {
      id: "app.settings",
      title: "Settings",
      group,
      keywords: ["preferences", "options", "config"],
      icon: Settings,
      run: () => settingsUiActions.open(),
    },
    {
      id: "app.merging",
      title: "Merge settings",
      group,
      keywords: ["merge", "squash", "rebase", "branch", "worktree", "approval"],
      icon: GitMerge,
      run: () => settingsUiActions.open("merging"),
    },
    {
      id: "app.workspace-settings",
      title: "Workspace settings",
      group,
      keywords: ["task limit", "running tasks", "queue"],
      icon: LayoutGrid,
      run: () => settingsUiActions.open("workspaces"),
    },
    {
      id: "app.devices",
      title: "Devices",
      group,
      keywords: ["phone", "pair", "passkeys", "access", "network", "tailscale"],
      icon: Smartphone,
      run: () => settingsUiActions.open("devices"),
    },
    {
      id: "app.notifications",
      title: "Notification settings",
      group,
      keywords: ["alerts", "sound", "browser"],
      icon: Bell,
      run: () => settingsUiActions.open("notifications"),
    },
    {
      id: "app.phone-notifications",
      title: "Phone notifications",
      group,
      keywords: ["telegram", "notify", "alerts", "push"],
      icon: Bell,
      run: () => settingsUiActions.open("notifications"),
    },
    {
      id: "app.schedules",
      title: "Schedules",
      group,
      keywords: ["cron", "timer", "recurring", "every day"],
      icon: Clock,
      run: () => schedulesUiActions.open(workspaceId),
    },
  ];
}
