import { ADropdownMenu, menuItem } from "@/components/a/ADropdownMenu";
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
} from "lucide-react";
import { tasksUiActions } from "@/stores/tasksUi";

interface SessionListHeaderProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onCloneFromGithub: () => void;
  onKillAll: () => void;
  onManageHosts: () => void;
  onNewWorkspace: () => void;
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
  pinControls,
}: SessionListHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-3">
      <div className="flex items-center gap-2.5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="bg-primary text-primary-foreground h-7 w-7 rounded-lg p-1.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </svg>
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
