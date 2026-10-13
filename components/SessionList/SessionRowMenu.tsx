"use client";

import {
  CheckSquare,
  AlarmClock,
  Archive,
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
  Play,
  Repeat,
  ChefHat,
  PinOff,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import * as DM from "@/components/ui/dropdown-menu";
import * as CM from "@/components/ui/context-menu";
import type { Session } from "@/lib/db";
import { selectionActions } from "@/stores/sessionSelection";
import { schedulesUiActions } from "@/stores/schedulesUi";
import { recipesUiActions } from "@/stores/recipesUi";
import { rowGroup } from "@/lib/recipes/chip";
import { useDoneAction } from "./useDoneAction";
import { useShelfActions } from "./useShelfActions";
import { SNOOZE_PRESETS, snoozePreset, wakeLabel } from "@/lib/sidebar/snooze";
import type { SidebarRow } from "@/lib/sidebar/shelves";
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
    // Disabled, but the reason keeps full contrast: only the label dims.
    <Item disabled className="items-start data-[disabled]:opacity-100">
      <Icon className={`${icon} mt-0.5 opacity-50`} />
      <span className="flex min-w-0 flex-col">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground text-xs leading-tight">
          {why}
        </span>
      </span>
    </Item>
  );
}

// The row's ⋯ menu (and right-click menu): everything a session can do.
export function SessionRowMenu({
  session,
  row,
  kind,
  onRename,
}: {
  session: Session;
  // Where it sits, for Snooze, Mark done and Reopen (not on an orchestrator).
  row?: SidebarRow;
  kind: keyof typeof PARTS;
  onRename: () => void;
}) {
  const ctx = useRowContext();
  const markDone = useDoneAction();
  const shelf = useShelfActions();
  const plain = !!row && !row.task && !session.task_status;
  const { Item, Separator, Sub, SubTrigger, SubContent } = PARTS[kind];
  const linked = useLinkedHostNames();
  // A linked machine's session: what can't reach it yet shows why.
  const blocked = remoteBlocks(session, (id) => linked[id]);
  const summarizing = ctx.summarizingSessionId === session.id;
  const cardUrl = ctx.cardUrl(session.id);
  const others = ctx.projects.filter(
    (p) => p.id !== session.project_id && !p.is_uncategorized
  );
  const group = rowGroup(session);
  const recipeRun = group?.kind === "recipe" ? { id: group.id } : null;
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
      {(session.role === "orchestrator" || session.has_brief) &&
        session.view === "chat" &&
        !session.archived_at &&
        !blocked && (
          <Item onClick={() => ctx.onFresh(session.id)}>
            <RotateCcw className={icon} />
            New conversation (keep brief)
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
      {recipeRun && (
        <>
          <Item onClick={() => recipesUiActions.openRecipe(recipeRun.id)}>
            <Repeat className={icon} />
            Open recipe
          </Item>
          <Item onClick={() => recipesUiActions.openRecipe(recipeRun.id, true)}>
            <Play className={icon} />
            Run again
          </Item>
        </>
      )}
      {!recipeRun && !session.role && !session.quick_of && (
        <Item
          onClick={() =>
            recipesUiActions.saveSessionAs(session.id, workspaceId)
          }
        >
          <ChefHat className={icon} />
          Save as recipe
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
          {row?.wakesAt ? (
            <Item onClick={() => shelf.unsnooze(session)}>
              <AlarmClock className={icon} />
              Unsnooze
            </Item>
          ) : (
            !session.pinned &&
            row && (
              <Sub>
                <SubTrigger>
                  <AlarmClock className={icon} />
                  Snooze
                </SubTrigger>
                <SubContent>
                  {SNOOZE_PRESETS.map((p) => (
                    <Item
                      key={p.key}
                      onClick={() => shelf.snooze(session, p.key)}
                    >
                      {p.label}
                      <span className="text-muted-foreground ml-3 text-xs">
                        {wakeLabel(snoozePreset(p.key).getTime())}
                      </span>
                    </Item>
                  ))}
                </SubContent>
              </Sub>
            )
          )}
          {plain &&
            (row.settled ? (
              <Item onClick={() => shelf.reopen(session)}>
                <RotateCcw className={icon} />
                Reopen
              </Item>
            ) : (
              <Item onClick={() => shelf.settle(session)}>
                <CircleCheck className={icon} />
                Mark done
              </Item>
            ))}
          <Item onClick={() => markDone(session)}>
            {plain ? (
              <Archive className={icon} />
            ) : (
              <CircleCheck className={icon} />
            )}
            {plain ? "Archive" : "Done"}
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
