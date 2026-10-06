import { ADropdownMenu, menuItem } from "@/components/a/ADropdownMenu";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  FolderPlus,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Trash2,
  Pin,
  PinOff,
  Server,
  LayoutGrid,
  ListTodo,
  MessagesSquare,
  BookOpen,
} from "lucide-react";
import { tasksUiActions } from "@/stores/tasksUi";
import { busUiActions } from "@/stores/busUi";

interface SessionListHeaderProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onCloneFromGithub: () => void;
  onKillAll: () => void;
  onManageHosts: () => void;
  onNewWorkspace: () => void;
  // Set when the active session's project has LumifyHub docs.
  onOpenDocs?: () => void;
  pinControls?: {
    isPinned: boolean;
    onTogglePin: () => void;
  };
}

export function SessionListHeader({
  onNewProject,
  onOpenProject,
  onCloneFromGithub,
  onKillAll,
  onManageHosts,
  onNewWorkspace,
  onOpenDocs,
  pinControls,
}: SessionListHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-3">
      <div className="flex items-center gap-2.5">
        <Logo />
        <h2 className="text-[15px] font-semibold tracking-tight">AgentOS</h2>
      </div>
      <div className="flex gap-1">
        {pinControls && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={pinControls.onTogglePin}
              >
                {pinControls.isPinned ? (
                  <PinOff className="h-4 w-4" />
                ) : (
                  <Pin className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{pinControls.isPinned ? "Unpin sidebar" : "Pin sidebar"}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <ADropdownMenu
          icon={Plus}
          tooltip="New project"
          items={[
            menuItem("New Project", onNewProject, { icon: FolderPlus }),
            menuItem("New Workspace", onNewWorkspace, { icon: LayoutGrid }),
            menuItem("New Task", tasksUiActions.openNew, { icon: ListTodo }),
            menuItem("Tasks", tasksUiActions.openPanel, { icon: ListTodo }),
            menuItem("Messages", busUiActions.open, { icon: MessagesSquare }),
            ...(onOpenDocs
              ? [menuItem("Docs", onOpenDocs, { icon: BookOpen })]
              : []),
            menuItem("Open Project", onOpenProject, { icon: FolderOpen }),
            menuItem("Clone from GitHub", onCloneFromGithub, {
              icon: GitBranch,
            }),
          ]}
        />
        <ADropdownMenu
          icon={MoreHorizontal}
          tooltip="More options"
          items={[
            menuItem("Machines", onManageHosts, { icon: Server }),
            menuItem("Kill all sessions", onKillAll, {
              icon: Trash2,
              variant: "destructive",
            }),
          ]}
        />
      </div>
    </div>
  );
}
