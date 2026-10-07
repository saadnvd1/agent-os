"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { ArrowLeft, Clock, Pencil, Play, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useWorkspacesQuery } from "@/data/workspaces";
import {
  useArchiveSchedule,
  useRunSchedule,
  useScheduleQuery,
  useSchedulesQuery,
  useUpdateSchedule,
} from "@/data/schedules";
import type { ScheduleView } from "@/lib/schedules";
import { formatRunTime } from "@/lib/schedules/cron";
import { schedulesUi, schedulesUiActions } from "@/stores/schedulesUi";
import { ScheduleForm } from "./ScheduleForm";
import { OutcomeChip, RunHistory } from "./RunHistory";

type View =
  | { mode: "list" }
  | { mode: "detail"; id: string }
  | { mode: "form"; id?: string };

const KIND_LABEL = {
  task: "Task",
  session: "Session",
  orchestrator: "Orchestrator",
} as const;

function NextRun({ s }: { s: ScheduleView }) {
  if (!s.enabled) return <>Off</>;
  if (s.paused) return <>Paused with the orchestrator</>;
  return s.nextRunAt ? (
    <>Next {formatRunTime(s.nextRunAt, s.timezone)}</>
  ) : (
    <>No upcoming run</>
  );
}

function EnableSwitch({ s }: { s: ScheduleView }) {
  const update = useUpdateSchedule();
  return (
    <span
      className="-m-3 flex min-h-11 min-w-11 items-center justify-center p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <Switch
        aria-label={s.enabled ? `Turn ${s.name} off` : `Turn ${s.name} on`}
        checked={s.enabled}
        disabled={update.isPending}
        onCheckedChange={(enabled) => update.mutate({ id: s.id, enabled })}
      />
    </span>
  );
}

function ScheduleRow({ s, onOpen }: { s: ScheduleView; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) =>
        e.target === e.currentTarget &&
        (e.key === "Enter" || e.key === " ") &&
        onOpen()
      }
      className="border-border/60 hover:bg-foreground/[0.03] focus-visible:ring-ring flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 outline-none focus-visible:ring-2"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{s.name}</span>
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {KIND_LABEL[s.kind]}
            {s.projectName ? ` · ${s.projectName}` : ""}
          </span>
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {s.description} · <NextRun s={s} />
        </p>
      </div>
      {s.lastRun && <OutcomeChip run={s.lastRun} />}
      <EnableSwitch s={s} />
    </div>
  );
}

function Detail({
  id,
  onEdit,
  onGone,
}: {
  id: string;
  onEdit: () => void;
  onGone: () => void;
}) {
  const { data, isPending, error } = useScheduleQuery(id);
  const run = useRunSchedule();
  const archive = useArchiveSchedule();
  const [confirm, setConfirm] = useState(false);
  if (isPending)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-xl" />;
  if (error || !data)
    return (
      <p className="text-destructive text-sm">
        {error?.message ?? "Not found"}
      </p>
    );
  const s = data.schedule;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-semibold">{s.name}</h3>
          <EnableSwitch s={s} />
        </div>
        <p className="text-muted-foreground text-sm">
          {KIND_LABEL[s.kind]}
          {s.projectName ? ` in ${s.projectName}` : ""} · {s.description}
        </p>
        <p className="text-muted-foreground text-xs">
          <NextRun s={s} /> · {s.timezone}
        </p>
      </div>
      <p className="bg-foreground/[0.03] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
        {s.prompt}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="h-11 md:h-8"
          disabled={run.isPending}
          onClick={() => run.mutate(s.id)}
        >
          <Play className="h-3.5 w-3.5" />
          {run.isPending ? "Starting..." : "Run now"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-11 md:h-8"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        {confirm ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-11 md:h-8"
            disabled={archive.isPending}
            onClick={() => archive.mutate(s.id, { onSuccess: onGone })}
          >
            Remove (keeps history)
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground h-11 md:h-8"
            onClick={() => setConfirm(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        )}
      </div>
      {run.error && (
        <p className="text-destructive text-sm">{run.error.message}</p>
      )}
      {run.data && run.data.run.outcome !== "started" && (
        <p className="text-destructive text-sm">
          {run.data.run.outcome}: {run.data.run.detail}
        </p>
      )}
      <RunHistory runs={data.runs} schedule={s} />
    </div>
  );
}

export function SchedulesDialog() {
  const snap = useSnapshot(schedulesUi);
  const [view, setView] = useState<View>({ mode: "list" });
  const { data: schedules = [], isPending } = useSchedulesQuery(
    snap.workspaceId,
    snap.open
  );
  const { data: workspaces = [] } = useWorkspacesQuery();
  const where = workspaces.find((w) => w.id === snap.workspaceId)?.name;
  const editing =
    view.mode === "form" && view.id
      ? schedules.find((s) => s.id === view.id)
      : undefined;

  const onOpenChange = (open: boolean) => {
    schedulesUiActions.setOpen(open);
    if (!open) setView({ mode: "list" });
  };
  const back =
    view.mode === "form" && view.id
      ? () => setView({ mode: "detail", id: view.id! })
      : () => setView({ mode: "list" });

  return (
    <Dialog open={snap.open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto [&>*]:min-w-0">
        <DialogHeader className="flex-row items-center gap-2 space-y-0 text-left">
          {view.mode !== "list" && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back"
              className="-ml-2 h-11 w-11 md:h-8 md:w-8"
              onClick={back}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <DialogTitle className="min-w-0 flex-1 truncate">
            {view.mode === "form"
              ? view.id
                ? "Edit schedule"
                : "New schedule"
              : `Schedules${where ? ` · ${where}` : ""}`}
          </DialogTitle>
          {view.mode === "list" && (
            <Button
              size="sm"
              className="mr-8 h-11 md:h-8"
              onClick={() => setView({ mode: "form" })}
            >
              <Plus className="h-4 w-4" />
              New
            </Button>
          )}
        </DialogHeader>
        <DialogDescription className="sr-only">
          Schedules start agent work at set times.
        </DialogDescription>

        {view.mode === "list" && (
          <div className="space-y-2">
            {isPending &&
              [0, 1].map((i) => (
                <div
                  key={i}
                  className="bg-muted/40 h-14 animate-pulse rounded-xl"
                />
              ))}
            {!isPending && schedules.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Clock className="text-primary h-6 w-6" />
                <p className="text-muted-foreground max-w-xs text-sm">
                  Nothing scheduled. A schedule starts a task, a session or a
                  message to the orchestrator at the times you pick, whether
                  AgentOS is open or not.
                </p>
              </div>
            )}
            {schedules.map((s) => (
              <ScheduleRow
                key={s.id}
                s={s}
                onOpen={() => setView({ mode: "detail", id: s.id })}
              />
            ))}
          </div>
        )}
        {view.mode === "detail" && (
          <Detail
            id={view.id}
            onEdit={() => setView({ mode: "form", id: view.id })}
            onGone={() => setView({ mode: "list" })}
          />
        )}
        {view.mode === "form" && (!view.id || editing) && (
          <ScheduleForm
            key={view.id ?? "new"}
            workspaceId={snap.workspaceId}
            existing={editing}
            onDone={(id) => setView({ mode: "detail", id })}
            onCancel={back}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
