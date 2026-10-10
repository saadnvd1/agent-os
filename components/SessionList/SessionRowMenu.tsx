"use client";

import {
  CheckSquare,
  CircleCheck,
  Clock,
  Copy,
  ExternalLink,
  FolderInput,
  GitBranch,
  GitPullRequest,
  KanbanSquare,
  Link,
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
import { schedulesUiActions } from "@/stores/schedulesUi";
import { useDoneAction } from "./useDoneAction";
import { useRowContext } from "./RowContext";
import { MoveMenuItems } from "@/components/Tasks/MoveMenuItems";
import { copySessionLink } from "@/hooks/useCopyToClipboard";
import { useLinkedHostNames } from "@/data/hosts";
import { remoteBlocks } from "@/lib/hosts/remote-menu";

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

interface BlockedProps {
  kind: keyof typeof PARTS;
  icon: typeof Copy;
  label: string;
  why: string;
}

// An action that can't run here yet: shown, disabled, with why.
function BlockedItem({ kind, icon: Icon, label, why }: BlockedProps) {
  const Item = PARTS[kind].Item;
  return (
    <Item disabled className="items-start">
      <Icon className={`${icon} mt-0.5`} />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        <span className="text-muted-foreground text-[11px] leading-tight">
          {why}
        </span>
      </span>
    </Item>
  );
}

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
  const linked = useLinkedHostNames();
  // A linked machine's session: what can't reach it yet shows why.
  const blocked = remoteBlocks(session, (id) => linked[id]);
  const summarizing = ctx.summarizingSessionId === session.id;
  const cardUrl = ctx.cardUrl(session.id);
  const others = ctx.projects.filter(
    (p) => p.id !== session.project_id && !p.is_uncategorized
  );
  const workspaceId =
    session.workspace_id ??
    ctx.projects.find((p) => p.id === session.project_id)?.workspace_id ??
    null;

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
      <Item onClick={() => copySessionLink(session.id)}>
        <Link className={icon} />
        Copy link
      </Item>
      <Item onClick={onRename}>
        <Pencil className={icon} />
        Rename
      </Item>
      {session.agent_type === "claude" && !session.role && blocked && (
        <BlockedItem
          kind={kind}
          icon={Copy}
          label="Fork session"
          why={blocked.fork}
        />
      )}
      {!session.role && blocked && (
        <BlockedItem
          kind={kind}
          icon={Sparkles}
          label="Fresh start"
          why={blocked.freshStart}
        />
      )}
      {session.agent_type === "claude" && !session.role && !blocked && (
        <Item onClick={() => ctx.onFork(session.id)}>
          <Copy className={icon} />
          Fork session
        </Item>
      )}
      {!session.role && !blocked && (
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
      <MoveMenuItems session={session} Item={Item} />
      {!session.role && others.length > 0 && blocked && (
        <BlockedItem
          kind={kind}
          icon={FolderInput}
          label="Move to project"
          why={blocked.moveToProject}
        />
      )}
      {!session.role && others.length > 0 && !blocked && (
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
      {workspaceId &&
        session.role !== "orchestrator" &&
        (!session.task_status || session.task_status === "running") &&
        blocked && (
          <BlockedItem
            kind={kind}
            icon={Clock}
            label="Schedule check-ins"
            why={blocked.schedule}
          />
        )}
      {workspaceId &&
        session.role !== "orchestrator" &&
        (!session.task_status || session.task_status === "running") &&
        !blocked && (
          <Item
            onClick={() =>
              schedulesUiActions.openDraft(workspaceId, {
                kind: "message",
                targetSessionId: session.id,
                name: `Check-in: ${session.name}`.slice(0, 80),
              })
            }
          >
            <Clock className={icon} />
            Schedule check-ins
          </Item>
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
