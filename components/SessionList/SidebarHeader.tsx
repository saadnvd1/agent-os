"use client";

import {
  Archive,
  Star,
  BookOpen,
  ChefHat,
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
  Settings,
  SquareTerminal,
  Trash2,
  Scale,
} from "lucide-react";
import {
  ADropdownMenu,
  menuItem,
  separator,
} from "@/components/a/ADropdownMenu";
import { Button } from "@/components/ui/button";
import type { Workspace } from "@/lib/db";
import { archivedUiActions } from "@/stores/archivedUi";
import { bookmarksUiActions } from "@/stores/bookmarksUi";
import { tasksUiActions } from "@/stores/tasksUi";
import { newDraft } from "@/stores/drafts";
import { schedulesUiActions } from "@/stores/schedulesUi";
import { recipesUiActions } from "@/stores/recipesUi";
import { busUiActions } from "@/stores/busUi";
import { settingsUiActions } from "@/stores/settingsUi";
import { usageUiActions } from "@/stores/usageUi";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { LoadGauge } from "./LoadGauge";
import { AwayToggle } from "@/components/Away/AwayToggle";
import { NoApprovalsBadge } from "@/components/Approvals/NoApprovalsBadge";
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
    <div className="flex flex-wrap items-center gap-x-1 px-3 pt-3 pb-2">
      <div className="flex min-w-[9.5rem] flex-1 items-center">
        <WorkspaceSwitcher
          workspaces={props.workspaces}
          current={props.workspace}
        />
        <LoadGauge />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <NoApprovalsBadge />
        <AwayToggle />
        <ADropdownMenu
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                schedules.failedText ? `More (${schedules.failedText})` : "More"
              }
              className="relative h-11 w-11 md:h-8 md:w-8 [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11"
            >
              <MoreHorizontal className="h-4 w-4" />
              {schedules.failed > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    failedDot,
                    "ring-background absolute top-2 right-2 ring-2 md:top-1 md:right-1 [@media(hover:none)]:md:top-2 [@media(hover:none)]:md:right-2"
                  )}
                />
              )}
            </Button>
          }
          items={[
            menuItem("Tasks", tasksUiActions.openPanel, { icon: ListTodo }),
            // Opens Settings > Schedules.
            menuItem("Schedules", () => schedulesUiActions.open(workspaceId), {
              icon: Clock,
              description: schedules.upcomingText ?? schedules.nextText,
              badge: schedules.failed > 0 && (
                <span className="text-destructive flex items-center gap-1.5 text-xs font-medium tabular-nums">
                  <span aria-hidden className={failedDot} />
                  <span aria-hidden>{schedules.failed}</span>
                  <span className="sr-only">{schedules.failedText}</span>
                </span>
              ),
            }),
            menuItem("Recipes", () => recipesUiActions.open(workspaceId), {
              icon: ChefHat,
            }),
            menuItem("Messages", busUiActions.open, { icon: MessagesSquare }),
            ...(props.onOpenDocs
              ? [menuItem("Docs", props.onOpenDocs, { icon: BookOpen })]
              : []),
            menuItem("Archived", () => archivedUiActions.open(), {
              icon: Archive,
            }),
            menuItem("Bookmarks", () => bookmarksUiActions.open(workspaceId), {
              icon: Star,
            }),
            menuItem("Usage", () => usageUiActions.open(), { icon: Gauge }),
            menuItem("Model comparison", () => usageUiActions.open("compare"), {
              icon: Scale,
            }),
            separator(),
            menuItem("Machines", props.onManageHosts, { icon: Server }),
            menuItem("Settings", () => settingsUiActions.open(), {
              icon: Settings,
            }),
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
              className="ml-0.5 h-11 w-11 rounded-[10px] md:h-8 md:w-8 [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11"
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
