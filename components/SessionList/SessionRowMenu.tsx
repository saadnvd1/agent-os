"use client";

import {
  CheckSquare,
  CircleCheck,
  Copy,
  ExternalLink,
  FolderInput,
  GitBranch,
  GitPullRequest,
  KanbanSquare,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
} from "lucide-react";
import * as DM from "@/components/ui/dropdown-menu";
import * as CM from "@/components/ui/context-menu";
import type { Session } from "@/lib/db";
import { selectionActions } from "@/stores/sessionSelection";
import { useDoneAction } from "./useDoneAction";
import { useRowContext } from "./RowContext";

const PARTS = {
  dropdown: {
    Item: DM.DropdownMenuItem,
    Separator: DM.DropdownMenuSeparator,
    Sub: DM.DropdownMenuSub,
    SubTrigger: DM.DropdownMenuSubTrigger,
    SubContent: DM.DropdownMenuSubContent,
  },
  context: {
    Item: CM.ContextMenuItem,
    Separator: CM.ContextMenuSeparator,
    Sub: CM.ContextMenuSub,
    SubTrigger: CM.ContextMenuSubTrigger,
    SubContent: CM.ContextMenuSubContent,
  },
};

const icon = "mr-2 h-3.5 w-3.5";

// The row's ⋯ menu (and right-click menu): everything a session can do.
export function SessionRowMenu({
  session,
  kind,
  onRename,
}: {
  session: Session;
  kind: keyof typeof PARTS;
  onRename: () => void;
}) {
  const ctx = useRowContext();
  const markDone = useDoneAction();
  const { Item, Separator, Sub, SubTrigger, SubContent } = PARTS[kind];
  const summarizing = ctx.summarizingSessionId === session.id;
  const cardUrl = ctx.cardUrl(session.id);
  const others = ctx.projects.filter(
    (p) => p.id !== session.project_id && !p.is_uncategorized
  );

  return (
    <>
      {session.branch_name && (
        <>
          <div className="text-muted-foreground flex flex-col gap-0.5 px-2 py-1.5 text-xs">
            <span className="flex items-center gap-1.5">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{session.branch_name}</span>
            </span>
            {session.worktree_path && (
              <span className="text-muted-foreground/70 max-w-[16rem] truncate font-mono text-[10px]">
                {session.worktree_path}
              </span>
            )}
          </div>
          <Separator />
        </>
      )}
      <Item onClick={() => ctx.onPin(session.id, !session.pinned)}>
        {session.pinned ? (
          <PinOff className={icon} />
        ) : (
          <Pin className={icon} />
        )}
        {session.pinned ? "Unpin" : "Pin"}
      </Item>
      {ctx.onOpenInTab && (
        <Item onClick={() => ctx.onOpenInTab?.(session.id)}>
          <ExternalLink className={icon} />
          Open in new tab
        </Item>
      )}
      <Item onClick={onRename}>
        <Pencil className={icon} />
        Rename
      </Item>
      {session.agent_type === "claude" && !session.role && (
        <Item onClick={() => ctx.onFork(session.id)}>
          <Copy className={icon} />
          Fork session
        </Item>
      )}
      {!session.role && (
        <Item
          onClick={() => ctx.onSummarize(session.id)}
          disabled={summarizing}
        >
          {summarizing ? (
            <Loader2 className={`${icon} animate-spin`} />
          ) : (
            <Sparkles className={icon} />
          )}
          {summarizing ? "Summarizing..." : "Fresh start"}
        </Item>
      )}
      {session.pr_url && (
        <Item onClick={() => window.open(session.pr_url!, "_blank")}>
          <GitPullRequest className={icon} />
          Open PR #{session.pr_number}
        </Item>
      )}
      {cardUrl && (
        <Item onClick={() => window.open(cardUrl, "_blank")}>
          <KanbanSquare className={icon} />
          LumifyHub card
        </Item>
      )}
      {!session.role && others.length > 0 && (
        <Sub>
          <SubTrigger>
            <FolderInput className={icon} />
            Move to project
          </SubTrigger>
          <SubContent>
            {others.map((p) => (
              <Item
                key={p.id}
                onClick={() => ctx.onMoveToProject(session.id, p.id)}
              >
                {p.name}
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      <Item
        onClick={() =>
          selectionActions.toggle(session.id, false, ctx.orderedIds())
        }
      >
        <CheckSquare className={icon} />
        Select
      </Item>
      {!session.role && (
        <>
          <Separator />
          <Item onClick={() => markDone(session)}>
            <CircleCheck className={icon} />
            Done
          </Item>
          <Item
            onClick={() => ctx.onDelete(session.id)}
            className="text-red-500 focus:text-red-500"
          >
            <Trash2 className={icon} />
            Delete session
          </Item>
        </>
      )}
    </>
  );
}
