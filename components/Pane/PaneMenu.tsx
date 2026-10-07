"use client";

import { toast } from "sonner";
import {
  Copy,
  MoreHorizontal,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Unplug,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { writeClipboard } from "@/hooks/useCopyToClipboard";
import type { Session } from "@/lib/db";
import { MoveMenuItems } from "@/components/Tasks/MoveMenuItems";

interface PaneMenuProps {
  session: Session | null | undefined;
  canSplit: boolean;
  canClose: boolean;
  hasAttachedTmux: boolean;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onClose: () => void;
  onDetach: () => void;
}

// The pane's less-used actions; the session's ids live here rather than in
// the bar.
export function PaneMenu({
  session,
  canSplit,
  canClose,
  hasAttachedTmux,
  onSplitHorizontal,
  onSplitVertical,
  onClose,
  onDetach,
}: PaneMenuProps) {
  const copyId = async (id: string) => {
    try {
      await writeClipboard(id);
      toast.success("Session ID copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Pane actions"
          className="h-7 w-7"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {session && (
          <>
            <DropdownMenuLabel className="space-y-0.5">
              <div className="truncate text-sm">{session.name}</div>
              {session.tmux_name && (
                <div className="text-muted-foreground truncate font-mono text-[11px] font-normal">
                  {session.tmux_name}
                </div>
              )}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => copyId(session.id)}>
              <Copy className="h-4 w-4" />
              Copy session ID
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <MoveMenuItems
              session={session}
              Item={DropdownMenuItem}
              After={DropdownMenuSeparator}
              iconClassName="h-4 w-4"
            />
          </>
        )}
        {hasAttachedTmux && (
          <DropdownMenuItem onSelect={onDetach}>
            <Unplug className="h-4 w-4" />
            Detach from tmux
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!canSplit} onSelect={onSplitHorizontal}>
          <SplitSquareHorizontal className="h-4 w-4" />
          Split right
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canSplit} onSelect={onSplitVertical}>
          <SplitSquareVertical className="h-4 w-4" />
          Split down
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canClose} onSelect={onClose}>
          <X className="h-4 w-4" />
          Close pane
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
