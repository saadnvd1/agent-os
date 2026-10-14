import type { Session } from "@/lib/db/types";
import type { SidebarRow } from "./shelves";
import { finishActions } from "./row-actions";

// What a session row's ⋯ / right-click menu offers, as data: which items,
// in which sections, and which sit together in a submenu. The component only
// draws it. An item that doesn't apply is absent, never shown disabled.
export type RowMenuItem =
  | "rename"
  | "pin"
  | "unpin"
  | "select"
  | "open-tab"
  | "open-pr"
  | "card"
  | "open-recipe"
  | "copy-link"
  | "share"
  | "fork"
  | "fresh-start"
  | "new-conversation"
  | "move-machine"
  | "move-project"
  | "check-ins"
  | "save-recipe"
  | "run-again"
  | "snooze"
  | "unsnooze"
  | "pause"
  | "resume"
  | "settle"
  | "reopen"
  | "done"
  | "restore"
  | "archive"
  | "delete";

export type RowMenuGroup = "open" | "share" | "restart" | "move" | "automate";

export type RowMenuEntry =
  | RowMenuItem
  | { group: RowMenuGroup; items: RowMenuItem[] };

export interface RowMenuInput {
  session: Pick<
    Session,
    | "role"
    | "quick_of"
    | "pinned"
    | "view"
    | "agent_type"
    | "task_status"
    | "pr_url"
    | "has_brief"
    | "archived_at"
    | "pause_state"
  >;
  row?: Pick<SidebarRow, "task" | "wakesAt" | "settled">;
  // A linked machine runs it: what can't reach it yet is left out.
  remote: boolean;
  canOpenInTab: boolean;
  hasCard: boolean;
  recipeRun: boolean;
  hasWorkspace: boolean;
  machineTargets: number;
  otherProjects: number;
}

export interface RowMenuPlan {
  sections: RowMenuEntry[][];
  // Say once why Fork, Fresh start, project moves and check-ins are missing.
  remoteNote: boolean;
}

const GROUP_LABEL: Record<RowMenuGroup, string> = {
  open: "Open",
  share: "Share",
  restart: "Fork or restart",
  move: "Move",
  automate: "Automate",
};
export const groupLabel = (g: RowMenuGroup) => GROUP_LABEL[g];

// A group of one is just that item; an empty one is nothing.
function group(
  g: RowMenuGroup,
  items: (RowMenuItem | false)[]
): RowMenuEntry[] {
  const kept = items.filter((i): i is RowMenuItem => !!i);
  if (kept.length === 0) return [];
  return kept.length === 1 ? kept : [{ group: g, items: kept }];
}

export function rowMenu(input: RowMenuInput): RowMenuPlan {
  const { session: s, row, remote } = input;
  const plain = !!row && !row.task && !s.task_status;
  const finish = finishActions(s, plain);
  const sections: RowMenuEntry[][] = [];

  // A quick change has no agent: its PR and the ways to finish it.
  if (s.quick_of) {
    sections.push(s.pr_url ? ["open-pr"] : []);
    sections.push(finish.filter((a) => a !== "archive"));
    sections.push(["archive", "delete"]);
    return {
      sections: sections.filter((x) => x.length),
      remoteNote: false,
    };
  }

  const orchestrator = s.role === "orchestrator";
  const agentRow = !s.role;
  const live = !remote;

  sections.push(["rename", s.pinned ? "unpin" : "pin", "select"]);

  sections.push([
    ...group("open", [
      input.canOpenInTab && "open-tab",
      !!s.pr_url && "open-pr",
      input.hasCard && "card",
      input.recipeRun && "open-recipe",
    ]),
    ...group("share", ["copy-link", s.view === "chat" && "share"]),
    ...group("restart", [
      s.agent_type === "claude" && agentRow && live && "fork",
      agentRow && live && "fresh-start",
      (orchestrator || !!s.has_brief) &&
        s.view === "chat" &&
        !s.archived_at &&
        live &&
        "new-conversation",
    ]),
    ...group("move", [
      input.machineTargets > 0 && "move-machine",
      agentRow && input.otherProjects > 0 && live && "move-project",
    ]),
    ...group("automate", [
      input.hasWorkspace &&
        !orchestrator &&
        (!s.task_status || s.task_status === "running") &&
        live &&
        "check-ins",
      input.recipeRun ? "run-again" : agentRow && "save-recipe",
    ]),
  ]);

  if (agentRow) {
    const state: RowMenuEntry[] = [];
    if (row?.wakesAt) state.push("unsnooze");
    else if (!s.pinned && row) state.push("snooze");
    const finished = !!s.task_status && s.task_status !== "running";
    if ((s.task_status || s.view === "chat") && !finished) {
      if (s.pause_state === "paused" || s.pause_state === "pausing")
        state.push("resume");
      else if (!s.pause_state) state.push("pause");
    }
    if (plain) state.push(row.settled ? "reopen" : "settle");
    state.push(...finish.filter((a) => a !== "archive"));
    sections.push(state);
    sections.push(["archive", "delete"]);
  }

  return {
    sections: sections.filter((x) => x.length),
    remoteNote: remote && agentRow,
  };
}
