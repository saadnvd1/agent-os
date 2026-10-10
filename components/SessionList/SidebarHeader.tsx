"use client";

import {
  Archive,
  BookOpen,
  Clock,
  FolderGit2,
  FolderPlus,
  Gauge,
  ListTodo,
  MessageSquarePlus,
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
import { newDraft } from "@/stores/drafts";
import { schedulesUiActions } from "@/stores/schedulesUi";
import { busUiActions } from "@/stores/busUi";
import { devicesUiActions } from "@/stores/devicesUi";
import { usageUiActions } from "@/stores/usageUi";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { LoadGauge } from "./LoadGauge";
import { useSchedulesGlance } from "./useSchedulesGlance";
import { cn } from "@/lib/utils";

// A failed schedule's red mark, on the "…" button and its Schedules item.
const failedDot = "bg-destructive h-2 w-2 rounded-full";

interface SidebarHeaderProps {
  workspaces: Workspace[];
  workspace: Workspace | null;
  onNewSession: () => void;
  onAddProject: () => void;
  onKillAll: () => void;
  onManageHosts: () => void;
  // Set when the active session's project has LumifyHub docs.
  onOpenDocs?: () => void;
  pinControls?: { isPinned: boolean; onTogglePin: () => void };
}

export function SidebarHeader(props: SidebarHeaderProps) {
  const { pinControls } = props;
  const workspaceId = props.workspace?.id ?? null;
  const schedules = useSchedulesGlance(workspaceId);
  return (
    <div className="flex items-center gap-1 px-3 pt-3 pb-2">
      <div className="flex min-w-0 flex-1 items-center">
        <WorkspaceSwitcher
          workspaces={props.workspaces}
          current={props.workspace}
        />
        <LoadGauge />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <ADropdownMenu
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                schedules.failedText ? `More (${schedules.failedText})` : "More"
              }
              className="relative h-11 w-11 md:h-8 md:w-8"
            >
              <MoreHorizontal className="h-4 w-4" />
              {schedules.failed > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    failedDot,
                    "ring-background absolute top-2 right-2 ring-2 md:top-1 md:right-1"
                  )}
                />
              )}
            </Button>
          }
          items={[
            menuItem("Tasks", tasksUiActions.openPanel, { icon: ListTodo }),
            menuItem("Schedules", () => schedulesUiActions.open(workspaceId), {
              icon: Clock,
              description: schedules.nextText,
              badge: schedules.failed > 0 && (
                <span className="text-destructive flex items-center gap-1.5 text-xs font-medium tabular-nums">
                  <span aria-hidden className={failedDot} />
                  <span aria-hidden>{schedules.failed}</span>
                  <span className="sr-only">{schedules.failedText}</span>
                </span>
              ),
            }),
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
          tooltip="New (⌥N)"
          trigger={
            <Button
              size="icon-sm"
              aria-label="New"
              className="ml-0.5 h-11 w-11 rounded-[10px] md:h-8 md:w-8"
            >
              <Plus className="h-4 w-4" />
            </Button>
          }
          items={[
            menuItem("New session", props.onNewSession, {
              icon: SquareTerminal,
            }),
            menuItem("In project…", () => newDraft({ kind: "choose" }), {
              icon: FolderGit2,
            }),
            menuItem("Scratch chat", () => newDraft({ kind: "scratch" }), {
              icon: MessageSquarePlus,
            }),
            menuItem(
              "New task",
              () => newDraft({ kind: "current", openPr: true }),
              { icon: ListTodo }
            ),
            separator(),
            menuItem("Add project", props.onAddProject, { icon: FolderPlus }),
          ]}
        />
      </div>
    </div>
  );
}
