"use client";

import { useState } from "react";
import {
  ExternalLink,
  GitMerge,
  KanbanSquare,
  SquareTerminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TaskView } from "@/lib/tasks";
import { isFinished } from "@/lib/tasks/state";
import {
  useApprovePlan,
  useArmTask,
  useDropTask,
  useSignOffTask,
} from "@/data/tasks";
import { Markdown } from "@/components/Chat/Markdown";
import { tmuxAttachActions } from "@/stores/tmuxAttach";
import { tasksUiActions } from "@/stores/tasksUi";
import { cn } from "@/lib/utils";
import { SimulatorIndicator } from "@/components/Simulator";
import { MoveTaskButton } from "./MoveTaskButton";
import { ResumeOnModel } from "./ResumeOnModel";
import { TASK_STATE as STATE } from "./task-state-labels";
import { formatTokens } from "@/components/Usage/format";

export function TaskRow({ task }: { task: TaskView }) {
  const signOff = useSignOffTask();
  const drop = useDropTask();
  const arm = useArmTask();
  const approve = useApprovePlan();
  const [showPlan, setShowPlan] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const live = !isFinished(task.state);
  const error =
    signOff.error?.message ||
    drop.error?.message ||
    arm.error?.message ||
    approve.error?.message ||
    moveError ||
    task.hostError;
  const settingUp = live && task.setup?.status === "running";
  const held = live && task.setup?.status === "held";
  const setupFailed =
    live && (task.setup?.status === "failed" || held) && !!task.setup?.error;

  return (
    <div className="bg-foreground/[0.03] space-y-2 rounded-xl px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.name}</p>
          <p className="text-muted-foreground truncate font-mono text-[11px]">
            {task.hostName && `${task.hostName} · `}
            {task.projectName} · {task.branch}
            {task.model &&
              ` · ${task.model}${task.planning ? " (planning)" : ""}`}
            {task.weighted ? ` · ${formatTokens(task.weighted)} weighted` : ""}
          </p>
          {task.plan && (
            <p className="text-muted-foreground truncate text-[11px]">
              {task.plan.planned ? "Planned" : "No plan"}
              {task.plan.reason && `: ${task.plan.reason}`}
            </p>
          )}
          {task.cardUrl && (
            <a
              href={task.cardUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center gap-1 text-[11px]"
            >
              <KanbanSquare className="h-3 w-3" />
              Card
            </a>
          )}
        </div>
        <span
          className={cn("shrink-0 text-xs font-medium", STATE[task.state].tone)}
        >
          {settingUp
            ? "Setting up"
            : held
              ? "Waiting to launch"
              : STATE[task.state].label}
        </span>
      </div>
      {setupFailed && (
        <p className="line-clamp-3 text-xs break-words text-amber-600 dark:text-amber-400">
          Setup: {task.setup?.error}
        </p>
      )}

      {live && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            // Its machine can't be reached: say why rather than open nothing.
            aria-disabled={!!task.hostError}
            title={task.hostError ?? undefined}
            className={cn(task.hostError && "cursor-not-allowed opacity-60")}
            onClick={() => {
              if (task.hostError) return;
              tmuxAttachActions.request(task.tmuxName, task.hostId ?? "local");
              tasksUiActions.setPanelOpen(false);
            }}
          >
            <SquareTerminal className="h-3.5 w-3.5" />
            Open
          </Button>
          {task.pr && (
            <Button size="sm" variant="outline" asChild>
              <a href={task.pr.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                PR #{task.pr.number}
              </a>
            </Button>
          )}
          {!task.hostId && <SimulatorIndicator sessionId={task.id} />}
          <MoveTaskButton task={task} onError={setMoveError} />
          {!task.hostId && <ResumeOnModel task={task} />}
          <span className="flex-1" />
          {confirmDrop ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={drop.isPending}
              onClick={() => drop.mutate(task.id)}
            >
              {drop.isPending ? "Dropping..." : "Confirm drop"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDrop(true)}
            >
              Drop
            </Button>
          )}
          {task.pr?.state === "OPEN" && !task.hostId && (
            <Button
              size="sm"
              className="h-11 md:h-8"
              variant={task.armed ? "secondary" : "outline"}
              aria-pressed={!!task.armed}
              title={
                task.armed
                  ? "Merges by itself once every gate passes. Click to disarm."
                  : "Merge by itself once every gate passes"
              }
              disabled={arm.isPending}
              onClick={() => arm.mutate({ id: task.id, armed: !task.armed })}
            >
              <GitMerge className="h-3.5 w-3.5" />
              {task.armed ? "Armed" : "Arm merge"}
            </Button>
          )}
          {task.state === "plan-ready" && (
            <>
              <Button
                size="sm"
                variant="outline"
                aria-expanded={showPlan}
                onClick={() => setShowPlan((v) => !v)}
              >
                {showPlan ? "Hide plan" : "View plan"}
              </Button>
              <Button
                size="sm"
                className="h-11 md:h-8"
                disabled={approve.isPending}
                onClick={() => approve.mutate({ id: task.id })}
              >
                {approve.isPending ? "Approving..." : "Approve"}
              </Button>
            </>
          )}
          {task.state === "review" && (
            <Button
              size="sm"
              disabled={signOff.isPending}
              onClick={() => signOff.mutate(task.id)}
            >
              {signOff.isPending ? "Merging..." : "Sign off & merge"}
            </Button>
          )}
        </div>
      )}
      {live && task.state === "plan-ready" && showPlan && (
        <div className="bg-foreground/[0.04] max-h-80 overflow-y-auto rounded-lg p-3 text-sm">
          {task.plan?.text ? (
            <Markdown text={task.plan.text} />
          ) : (
            <p className="text-muted-foreground text-xs">
              No plan file was written.
            </p>
          )}
          {task.plan?.truncated && (
            <p className="text-muted-foreground mt-2 font-mono text-[11px]">
              Shortened; the whole plan is {task.plan.path} in the worktree.
            </p>
          )}
        </div>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
