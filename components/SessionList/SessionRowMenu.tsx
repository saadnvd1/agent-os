"use client";

import { Fragment } from "react";
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
  Share2,
  Loader2,
  Pencil,
  Pin,
  Pause,
  Play,
  Repeat,
  ChefHat,
  PinOff,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Session } from "@/lib/db";
import { selectionActions } from "@/stores/sessionSelection";
import { schedulesUiActions } from "@/stores/schedulesUi";
import { recipesUiActions } from "@/stores/recipesUi";
import { rowGroup } from "@/lib/recipes/chip";
import {
  useArchiveAction,
  useDoneAction,
  useResurrectAction,
} from "./useDoneAction";
import { useShelfActions } from "./useShelfActions";
import {
  PAUSE_PRESETS,
  SNOOZE_PRESETS,
  pauseUntil,
  snoozePreset,
  wakeLabel,
} from "@/lib/sidebar/snooze";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { useRowContext } from "./RowContext";
import { MoveMenuItems } from "@/components/Tasks/MoveMenuItems";
import { shareUiActions } from "@/stores/shareUi";
import { copySessionLink } from "@/hooks/useCopyToClipboard";
import { useLinkedHostNames } from "@/data/hosts";
import { remoteBlocks, remoteNote } from "@/lib/hosts/remote-menu";
import { movableSession } from "@/lib/tasks/move-targets";
import { useMoveTargets } from "@/data/tasks/move";
import {
  rowMenu,
  groupLabel,
  type RowMenuGroup,
  type RowMenuItem,
} from "@/lib/sidebar/row-menu";
import { Expander, MenuItem, PARTS, icon, type MenuKind } from "./RowMenuParts";
import { MoveToGroupMenu } from "./MoveToGroupMenu";

const GROUP_ICON: Record<RowMenuGroup, typeof Copy> = {
  open: ExternalLink,
  share: Share2,
  restart: Copy,
  move: FolderInput,
  automate: Clock,
};

// The row's ⋯ menu (and right-click menu): everything a session can do. What
// it offers is decided in lib/sidebar/row-menu; this only draws it.
export function SessionRowMenu({
  session,
  row,
  kind,
  onRename,
}: {
  session: Session;
  // Where it sits, for Snooze, Mark done and Reopen (not on an orchestrator).
  row?: SidebarRow;
  kind: MenuKind;
  onRename: () => void;
}) {
  const ctx = useRowContext();
  const shelf = useShelfActions();
  const markDone = useDoneAction();
  const archive = useArchiveAction();
  const restore = useResurrectAction();
  const { Separator } = PARTS[kind];
  const linked = useLinkedHostNames();
  const remote = remoteBlocks(session, (id) => linked[id]);
  const targets = useMoveTargets(movableSession(session));
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

  // The server files by the project's workspace first.
  const groupWorkspaceId =
    ctx.projects.find((p) => p.id === session.project_id)?.workspace_id ??
    session.workspace_id ??
    null;

  const plan = rowMenu({
    session,
    row,
    remote: !!remote,
    canOpenInTab: !!ctx.onOpenInTab,
    hasCard: !!cardUrl,
    recipeRun: !!recipeRun,
    hasWorkspace: !!workspaceId,
    machineTargets: targets.length,
    otherProjects: others.length,
  });

  const item = (
    label: string,
    Icon: typeof Copy,
    onClick: () => void,
    extra?: { className?: string; disabled?: boolean; spin?: boolean }
  ) => (
    <MenuItem
      key={label}
      kind={kind}
      onClick={onClick}
      disabled={extra?.disabled}
      className={extra?.className}
    >
      <Icon className={`${icon}${extra?.spin ? "animate-spin" : ""}`} />
      {label}
    </MenuItem>
  );
  const open = (url: string) => () => window.open(url, "_blank");
  const projects = others.map((p) => (
    <MenuItem
      key={p.id}
      kind={kind}
      onClick={() => ctx.onMoveToProject(session.id, p.id)}
    >
      {p.name}
    </MenuItem>
  ));
  const wake = (ms: number | null) =>
    ms && (
      <span className="text-muted-foreground ml-3 text-xs">
        {wakeLabel(ms)}
      </span>
    );

  const render = (it: RowMenuItem, inGroup: boolean) => {
    switch (it) {
      case "rename":
        return item("Rename", Pencil, onRename);
      case "pin":
        return item("Pin", Pin, () => ctx.onPin(session.id, true));
      case "unpin":
        return item("Unpin", PinOff, () => ctx.onPin(session.id, false));
      case "select":
        return item("Select", CheckSquare, () =>
          selectionActions.toggle(session.id, false, ctx.orderedIds())
        );
      case "open-tab":
        return item("Open in new tab", ExternalLink, () =>
          ctx.onOpenInTab?.(session.id)
        );
      case "open-pr":
        return item(
          `Open PR #${session.pr_number}`,
          GitPullRequest,
          open(session.pr_url!)
        );
      case "card":
        return item("LumifyHub card", KanbanSquare, open(cardUrl!));
      case "open-recipe":
        return item("Open recipe", Repeat, () =>
          recipesUiActions.openRecipe(recipeRun!.id)
        );
      case "copy-link":
        return item("Copy link", Link, () => copySessionLink(session.id));
      case "share":
        return item("Share…", Share2, () =>
          shareUiActions.open({
            kind: "chat",
            sessionId: session.id,
            title: session.name,
          })
        );
      case "fork":
        return item("Fork session", Copy, () => ctx.onFork(session.id));
      case "fresh-start":
        return item(
          summarizing ? "Summarizing..." : "Fresh start",
          summarizing ? Loader2 : Sparkles,
          () => ctx.onSummarize(session.id),
          { disabled: summarizing, spin: summarizing }
        );
      case "new-conversation":
        return item("New conversation (keep brief)", RotateCcw, () =>
          ctx.onFresh(session.id)
        );
      case "move-machine":
        return (
          <MoveMenuItems key={it} session={session} Item={PARTS[kind].Item} />
        );
      case "move-project":
        return inGroup ? (
          <div key={it}>
            {targets.length > 0 && <Separator />}
            {projects}
          </div>
        ) : (
          <Expander
            key={it}
            kind={kind}
            icon={FolderInput}
            label="Move to project"
          >
            {projects}
          </Expander>
        );
      case "move-group":
        return (
          <MoveToGroupMenu
            key={it}
            kind={kind}
            sessionId={session.id}
            groupId={session.session_group_id}
            workspaceId={groupWorkspaceId}
          />
        );
      case "check-ins":
        return item("Schedule check-ins", Clock, () =>
          schedulesUiActions.openDraft(workspaceId!, {
            kind: "message",
            targetSessionId: session.id,
            name: `Check-in: ${session.name}`.slice(0, 80),
          })
        );
      case "save-recipe":
        return item("Save as recipe", ChefHat, () =>
          recipesUiActions.saveSessionAs(session.id, workspaceId)
        );
      case "run-again":
        return item("Run again", Play, () =>
          recipesUiActions.openRecipe(recipeRun!.id, true)
        );
      case "snooze":
        return (
          <Expander key={it} kind={kind} icon={AlarmClock} label="Snooze">
            {SNOOZE_PRESETS.map((p) => (
              <MenuItem
                key={p.key}
                kind={kind}
                onClick={() => shelf.snooze(session, p.key)}
              >
                {p.label}
                {wake(snoozePreset(p.key).getTime())}
              </MenuItem>
            ))}
          </Expander>
        );
      case "unsnooze":
        return item("Unsnooze", AlarmClock, () => shelf.unsnooze(session));
      case "pause":
        return (
          <Expander key={it} kind={kind} icon={Pause} label="Pause">
            {PAUSE_PRESETS.map((p) => (
              <MenuItem
                key={p.key}
                kind={kind}
                onClick={() => shelf.pause(session, p.key)}
              >
                {p.label}
                {wake(pauseUntil(p.key)?.getTime() ?? null)}
              </MenuItem>
            ))}
            <MenuItem
              kind={kind}
              onClick={() => shelf.pause(session, "until-resumed", true)}
            >
              Pause now (interrupt its step)
            </MenuItem>
          </Expander>
        );
      case "resume":
        return item(
          session.pause_state === "paused" ? "Resume now" : "Keep running",
          Play,
          () => shelf.resume(session)
        );
      case "settle":
        return item("Mark done", CircleCheck, () => shelf.settle(session));
      case "reopen":
        return item("Reopen", RotateCcw, () => shelf.reopen(session));
      case "done":
        return item("Done", CircleCheck, () => markDone(session));
      case "restore":
        return item("Restore", RotateCcw, () => restore(session));
      case "archive":
        return item("Archive", Archive, () => archive(session));
      case "delete":
        return item("Delete session", Trash2, () => ctx.onDelete(session.id), {
          className: "text-red-500 focus:text-red-500",
        });
    }
  };

  return (
    <>
      {session.branch_name && !session.quick_of && (
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
      {plan.remoteNote && remote && (
        <div className="text-muted-foreground px-2 py-1.5 text-xs leading-tight">
          {remoteNote(linked[session.host_id!] ?? "its machine")}
        </div>
      )}
      {plan.sections.map((section, i) => (
        <Fragment key={i}>
          {i > 0 && <Separator />}
          {section.map((entry) =>
            typeof entry === "string" ? (
              render(entry, false)
            ) : (
              <Expander
                key={entry.group}
                kind={kind}
                icon={GROUP_ICON[entry.group]}
                label={groupLabel(entry.group)}
              >
                {entry.items.map((it) => (
                  <Fragment key={it}>{render(it, true)}</Fragment>
                ))}
              </Expander>
            )
          )}
        </Fragment>
      ))}
    </>
  );
}
