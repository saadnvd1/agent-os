"use client";

import { useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  Gauge,
  LayoutGrid,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import * as DM from "@/components/ui/dropdown-menu";
import { WorkspaceNameDialog } from "@/components/Workspaces";
import { settingsUiActions } from "@/stores/settingsUi";
import { taskLimitLabel } from "@/components/Workspaces/task-limit";
import { WorkspaceLumifyHubItem } from "@/components/LumifyHub/MenuItems";
import type { Workspace } from "@/lib/db";
import {
  useCreateWorkspace,
  useDeleteWorkspace,
  useUpdateWorkspace,
} from "@/data/workspaces";
import { archivedUiActions, cleanupUiActions } from "@/stores/archivedUi";
import { orchestratorOpenActions } from "@/stores/orchestratorOpen";
import { sidebarUiActions } from "@/stores/sidebarUi";
import { schedulesUiActions } from "@/stores/schedulesUi";

const icon = "mr-2 h-3.5 w-3.5";

// The name at the top: pick a workspace (or all of them), and run the
// current one: its orchestrator, clean-up, archive, LumifyHub link.
export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: Workspace[];
  current: Workspace | null;
}) {
  const create = useCreateWorkspace();
  const update = useUpdateWorkspace();
  const remove = useDeleteWorkspace();
  const [dialog, setDialog] = useState<"new" | "rename" | null>(null);
  const name = current?.name ?? "All workspaces";

  return (
    <>
      <DM.DropdownMenu>
        <DM.DropdownMenuTrigger asChild>
          <button
            type="button"
            title={name}
            className="hover:bg-foreground/[0.04] -ml-1.5 flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 md:min-h-9"
          >
            <MiddleTruncate
              text={name}
              className="text-[15px] font-semibold tracking-tight"
            />
            <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          </button>
        </DM.DropdownMenuTrigger>
        <DM.DropdownMenuContent align="start" className="w-60">
          <DM.DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            Workspace
          </DM.DropdownMenuLabel>
          {[null, ...workspaces].map((w) => (
            <DM.DropdownMenuItem
              key={w?.id ?? "all"}
              onClick={() => sidebarUiActions.setWorkspace(w?.id ?? null)}
            >
              <LayoutGrid className={icon} />
              <span className="flex-1 truncate">
                {w?.name ?? "All workspaces"}
              </span>
              {(current?.id ?? null) === (w?.id ?? null) && (
                <Check className="text-primary h-3.5 w-3.5" />
              )}
            </DM.DropdownMenuItem>
          ))}
          <DM.DropdownMenuItem onClick={() => setDialog("new")}>
            <Plus className={icon} />
            New workspace
          </DM.DropdownMenuItem>
          {!current && (
            <DM.DropdownMenuItem onClick={() => schedulesUiActions.open(null)}>
              <Clock className={icon} />
              Schedules
            </DM.DropdownMenuItem>
          )}
          {current && (
            <>
              <DM.DropdownMenuSeparator />
              <DM.DropdownMenuItem
                onClick={() => orchestratorOpenActions.request(current.id)}
              >
                <Workflow className={icon} />
                Orchestrator
              </DM.DropdownMenuItem>
              <DM.DropdownMenuItem
                onClick={() => schedulesUiActions.open(current.id)}
              >
                <Clock className={icon} />
                Schedules
              </DM.DropdownMenuItem>
              <DM.DropdownMenuItem onClick={() => setDialog("rename")}>
                <Pencil className={icon} />
                Rename
              </DM.DropdownMenuItem>
              <DM.DropdownMenuItem
                onClick={() => settingsUiActions.open("workspaces")}
              >
                <Gauge className={icon} />
                <span className="flex-1">Task limit</span>
                <span className="text-muted-foreground text-xs">
                  {taskLimitLabel(current.max_running_tasks)}
                </span>
              </DM.DropdownMenuItem>
              <DM.DropdownMenuItem
                onClick={() => cleanupUiActions.open(current.id)}
              >
                <CircleCheck className={icon} />
                Clean up idle sessions
              </DM.DropdownMenuItem>
              <DM.DropdownMenuItem
                onClick={() => archivedUiActions.open(current.id)}
              >
                <Archive className={icon} />
                Archived
              </DM.DropdownMenuItem>
              <WorkspaceLumifyHubItem
                workspace={current}
                Item={DM.DropdownMenuItem}
              />
              <DM.DropdownMenuItem
                onClick={() => {
                  remove.mutate(current.id);
                  sidebarUiActions.setWorkspace(null);
                }}
                className="text-red-500 focus:text-red-500"
              >
                <Trash2 className={icon} />
                Delete (keeps projects)
              </DM.DropdownMenuItem>
            </>
          )}
        </DM.DropdownMenuContent>
      </DM.DropdownMenu>
      <WorkspaceNameDialog
        open={dialog === "new" || dialog === "rename"}
        title={dialog === "rename" ? "Rename workspace" : "New workspace"}
        initialName={dialog === "rename" ? current?.name : ""}
        submitLabel={dialog === "rename" ? "Rename" : "Create"}
        onSubmit={(name) =>
          dialog === "rename" && current
            ? update.mutate({ id: current.id, name })
            : create.mutate(name)
        }
        onClose={() => setDialog(null)}
      />
    </>
  );
}

const TAIL = 4;

// Cuts a name that doesn't fit in the middle ("All wo…aces"), so the end
// that tells similar names apart stays: the head truncates, the tail doesn't.
function MiddleTruncate({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (text.length <= TAIL * 2) {
    return <span className={`truncate ${className}`}>{text}</span>;
  }
  // Screen readers get the name whole, not as two words.
  return (
    <span className={`flex min-w-0 ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="truncate whitespace-pre">
        {text.slice(0, -TAIL)}
      </span>
      <span aria-hidden className="shrink-0 whitespace-pre">
        {text.slice(-TAIL)}
      </span>
    </span>
  );
}
