"use client";

import {
  Archive,
  BookOpen,
  Clock,
  FolderOpen,
  FolderPlus,
  Gauge,
  GitBranch,
  ListTodo,
  MessagesSquare,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Server,
  Smartphone,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import {
  ADropdownMenu,
  menuItem,
  separator,
} from "@/components/a/ADropdownMenu";
import { Button } from "@/components/ui/button";
import type { Workspace } from "@/lib/db";
import { archivedUiActions } from "@/stores/archivedUi";
import { tasksUiActions } from "@/stores/tasksUi";
import { schedulesUiActions } from "@/stores/schedulesUi";
import { busUiActions } from "@/stores/busUi";
import { devicesUiActions } from "@/stores/devicesUi";
import { usageUiActions } from "@/stores/usageUi";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { LoadGauge } from "./LoadGauge";

interface SidebarHeaderProps {
  workspaces: Workspace[];
  workspace: Workspace | null;
  onNewSession: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onCloneFromGithub: () => void;
  onKillAll: () => void;
  onManageHosts: () => void;
  // Set when the active session's project has LumifyHub docs.
  onOpenDocs?: () => void;
  pinControls?: { isPinned: boolean; onTogglePin: () => void };
}

export function SidebarHeader(props: SidebarHeaderProps) {
  const { pinControls } = props;
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
      <WorkspaceSwitcher
        workspaces={props.workspaces}
        current={props.workspace}
      />
      <div className="flex shrink-0 items-center gap-0.5">
        <LoadGauge />
        <ADropdownMenu
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More"
              className="h-11 w-11 md:h-8 md:w-8"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          }
          items={[
            menuItem("Tasks", tasksUiActions.openPanel, { icon: ListTodo }),
            menuItem(
              "Schedules",
              () => schedulesUiActions.open(props.workspace?.id ?? null),
              { icon: Clock }
            ),
            menuItem("Messages", busUiActions.open, { icon: MessagesSquare }),
            ...(props.onOpenDocs
              ? [menuItem("Docs", props.onOpenDocs, { icon: BookOpen })]
              : []),
            menuItem("Archived", () => archivedUiActions.open(), {
              icon: Archive,
            }),
            menuItem("Usage", usageUiActions.open, { icon: Gauge }),
            separator(),
            menuItem("Machines", props.onManageHosts, { icon: Server }),
            menuItem("Devices", devicesUiActions.open, { icon: Smartphone }),
            ...(pinControls
              ? [
                  menuItem(
                    pinControls.isPinned ? "Unpin sidebar" : "Pin sidebar",
                    pinControls.onTogglePin,
                    { icon: pinControls.isPinned ? PinOff : Pin }
                  ),
                ]
              : []),
            separator(),
            menuItem("Kill all sessions", props.onKillAll, {
              icon: Trash2,
              variant: "destructive",
            }),
          ]}
        />
        <ADropdownMenu
          trigger={
            <Button
              size="sm"
              className="ml-1 h-11 gap-1 rounded-[10px] px-3 md:h-8"
            >
              <Plus className="h-4 w-4" />
              New
            </Button>
          }
          items={[
            menuItem("New session", props.onNewSession, {
              icon: SquareTerminal,
            }),
            menuItem("New task", tasksUiActions.openNew, { icon: ListTodo }),
            separator(),
            menuItem("New project", props.onNewProject, { icon: FolderPlus }),
            menuItem("Open project", props.onOpenProject, {
              icon: FolderOpen,
            }),
            menuItem("Clone from GitHub", props.onCloneFromGithub, {
              icon: GitBranch,
            }),
          ]}
        />
      </div>
    </div>
  );
}
