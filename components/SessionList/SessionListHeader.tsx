import { useState } from "react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  RefreshCw,
  FolderPlus,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SessionListHeaderProps {
  onRefresh: () => Promise<void>;
  onNewSession: () => void;
  onNewProject: () => void;
  onKillAll: () => void;
}

export function SessionListHeader({
  onRefresh,
  onNewSession,
  onNewProject,
  onKillAll,
}: SessionListHeaderProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  return (
    <div className="flex items-center justify-between p-4 pb-3">
      <div className="flex items-center gap-2">
        <Image src="/icon.svg" alt="AgentOS" width={20} height={20} />
        <h2 className="font-semibold">AgentOS</h2>
      </div>
      <div className="flex gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onNewSession}>
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New session</TooltipContent>
        </Tooltip>
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
            <DropdownMenuItem onClick={onNewProject}>
              <FolderPlus className="mr-2 h-3 w-3" />
              New project
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
