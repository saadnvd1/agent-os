import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  FolderPlus,
  FolderOpen,
  MoreHorizontal,
  Trash2,
} from "lucide-react";

interface SessionListHeaderProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onKillAll: () => void;
}

export function SessionListHeader({
  onNewProject,
  onOpenProject,
  onKillAll,
}: SessionListHeaderProps) {
  return (
    <div className="flex items-center justify-between p-4 pb-3">
      <div className="flex items-center gap-2">
        <Image src="/icon.svg" alt="AgentOS" width={20} height={20} />
        <h2 className="font-semibold">AgentOS</h2>
      </div>
      <div className="flex gap-1">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>New project</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onNewProject}>
              <FolderPlus className="mr-2 h-3 w-3" />
              New Project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenProject}>
              <FolderOpen className="mr-2 h-3 w-3" />
              Open Project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>More options</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={onKillAll}
              className="text-red-500 focus:text-red-500"
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Kill all sessions
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
