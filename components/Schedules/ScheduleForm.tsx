"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useProjectsQuery } from "@/data/projects";
import { useWorkspacesQuery } from "@/data/workspaces";
import { useCreateSchedule, useUpdateSchedule } from "@/data/schedules";
import { useSessionsQuery } from "@/data/sessions";
import type { ScheduleKind, ScheduleView } from "@/lib/schedules";
import type { ScheduleDraft } from "@/stores/schedulesUi";
import {
  clock12,
  cronError,
  cronPreset,
  DEFAULT_TIMEZONE,
  describeCron,
  formatRunTime,
  isTimezone,
  MESSAGE_MIN_GAP_MINUTES,
  MIN_GAP_MINUTES,
  minGapMinutes,
  nextRuns,
  presetCron,
  type PresetKind,
} from "@/lib/schedules/cron";

const KINDS: { value: ScheduleKind; label: string; hint: string }[] = [
  {
    value: "task",
    label: "Task",
    hint: "Works alone in a fresh worktree and ends in a pull request.",
  },
  {
    value: "session",
    label: "Session",
    hint: "A chat session in the project that runs the prompt and stays open.",
  },
  {
    value: "orchestrator",
    label: "Orchestrator",
    hint: "Posts the prompt to this workspace's orchestrator.",
  },
  {
    value: "message",
    label: "Message",
    hint: "Sends the prompt to a session you pick, waking it if its chat has stopped. Skips a run while it's still working.",
  },
];

const PRESETS: { value: PresetKind | "custom"; label: string }[] = [
  { value: "every", label: "Every…" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const EVERY = [10, 15, 20, 30];
// Only these may run more than once an hour.
const frequent = (k: ScheduleKind) => k === "orchestrator" || k === "message";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "bg-foreground/[0.04] grid gap-1 rounded-lg p-1 md:flex",
        // Wraps on a phone rather than cutting labels short.
        options.length === 4 ? "grid-cols-2" : "grid-cols-3"
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-11 min-w-0 flex-1 truncate rounded-md px-1 text-xs font-medium transition-colors md:min-h-8 md:px-3 md:text-sm",
            value === o.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-2">
    <label className="text-sm font-medium">{label}</label>
    {children}
  </div>
);

export function ScheduleForm({
  workspaceId,
  existing,
  draft,
  onDone,
  onCancel,
}: {
  workspaceId: string | null;
  existing?: ScheduleView;
  draft?: ScheduleDraft | null;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { data: workspaces = [] } = useWorkspacesQuery();
  const { data: projects = [] } = useProjectsQuery();
  const { data: sessionData } = useSessionsQuery();
  const create = useCreateSchedule();
  const update = useUpdateSchedule();
  const mutation = existing ? update : create;

  const initialPreset = existing ? cronPreset(existing.cron) : null;
  const [wsId, setWsId] = useState(
    existing?.workspace_id ?? workspaceId ?? workspaces[0]?.id ?? ""
  );
  const [name, setName] = useState(existing?.name ?? draft?.name ?? "");
  const [kind, setKind] = useState<ScheduleKind>(
    existing?.kind ?? draft?.kind ?? "task"
  );
  const [targetId, setTargetId] = useState(
    existing?.target_session_id ?? draft?.targetSessionId ?? ""
  );
  const [projectId, setProjectId] = useState(existing?.project_id ?? "");
  const [prompt, setPrompt] = useState(existing?.prompt ?? "");
  const [preset, setPreset] = useState<PresetKind | "custom">(
    existing ? (initialPreset?.kind ?? "custom") : draft ? "every" : "weekdays"
  );
  const [every, setEvery] = useState(initialPreset?.every ?? 30);
  const [hour, setHour] = useState(initialPreset?.hour ?? 9);
  const [minute, setMinute] = useState(initialPreset?.minute ?? 0);
  const [weekday, setWeekday] = useState(initialPreset?.weekday ?? 1);
  const [custom, setCustom] = useState(existing?.cron ?? "0 9 * * 1-5");
  const [timezone, setTimezone] = useState(
    existing?.timezone ?? DEFAULT_TIMEZONE
  );

  const workspace = wsId || workspaces[0]?.id || "";
  const eligible = projects.filter(
    (p) =>
      !p.is_uncategorized &&
      p.workspace_id === workspace &&
      (!p.host_id || p.host_id === "local")
  );
  const project =
    eligible.find((p) => p.id === projectId)?.id ??
    (frequent(kind) ? "" : (eligible[0]?.id ?? ""));
  // Sessions a message can go to: live ones in this workspace, by name.
  const projectWs = new Map(projects.map((p) => [p.id, p.workspace_id]));
  const targets = (sessionData?.sessions ?? [])
    .filter(
      (s) =>
        !s.archived_at &&
        s.role !== "orchestrator" &&
        (!s.task_status || s.task_status === "running") &&
        (s.workspace_id ??
          (s.project_id ? projectWs.get(s.project_id) : null)) === workspace
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const target = targets.find((s) => s.id === targetId)?.id ?? "";

  const cron =
    preset === "custom"
      ? custom.trim()
      : presetCron({ kind: preset, hour, minute, weekday, every });
  const tzOk = isTimezone(timezone);
  const cronProblem = cronError(cron);
  // The preview counts from now, kept fresh while the form is open.
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setOpenedAt(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const preview = useMemo(
    () => (cronProblem || !tzOk ? [] : nextRuns(cron, openedAt, 3, timezone)),
    [cron, cronProblem, timezone, tzOk, openedAt]
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      workspaceId: workspace,
      projectId: project || null,
      name,
      cron,
      timezone,
      prompt,
      kind,
      targetSessionId: kind === "message" ? target : null,
    };
    const opts = {
      onSuccess: (data: { schedule: ScheduleView }) => onDone(data.schedule.id),
    };
    if (existing) update.mutate({ id: existing.id, ...input }, opts);
    else create.mutate(input, opts);
  };

  const minGap =
    kind === "message"
      ? MESSAGE_MIN_GAP_MINUTES
      : kind === "orchestrator"
        ? 0
        : MIN_GAP_MINUTES;
  const tooOften = useMemo(
    () =>
      minGap > 0 &&
      !cronProblem &&
      tzOk &&
      minGapMinutes(cron, timezone, openedAt) < minGap,
    [minGap, cron, cronProblem, timezone, tzOk, openedAt]
  );

  const ready =
    name.trim() &&
    prompt.trim() &&
    workspace &&
    !cronProblem &&
    tzOk &&
    !tooOften &&
    (kind === "message" ? target : kind === "orchestrator" || project);

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Name">
        <Input
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Morning triage"
          className="h-11 md:h-9"
          autoFocus={!existing}
        />
      </Field>

      <Field label="What it starts">
        <Segmented
          label="What it starts"
          value={kind}
          options={KINDS}
          onChange={(k) => {
            setKind(k);
            if (preset === "every" && !frequent(k)) setPreset("daily");
          }}
        />
        <p className="text-muted-foreground text-xs">
          {KINDS.find((k) => k.value === kind)?.hint}
        </p>
      </Field>

      {!workspaceId && (
        <Field label="Workspace">
          <Select value={workspace} onValueChange={setWsId}>
            <SelectTrigger aria-label="Workspace" className="h-11 md:h-9">
              <SelectValue placeholder="Pick a workspace" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {kind === "message" ? (
        <Field label="Session">
          <Select value={target} onValueChange={setTargetId}>
            <SelectTrigger aria-label="Session" className="h-11 md:h-9">
              <SelectValue placeholder="Pick a session" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targets.length === 0 && (
            <p className="text-muted-foreground text-xs">
              This workspace has no open sessions.
            </p>
          )}
        </Field>
      ) : (
        <Field
          label={kind === "orchestrator" ? "Project (optional)" : "Project"}
        >
          <Select
            value={project || "none"}
            onValueChange={(v) => setProjectId(v === "none" ? "" : v)}
          >
            <SelectTrigger aria-label="Project" className="h-11 md:h-9">
              <SelectValue placeholder="Pick a project" />
            </SelectTrigger>
            <SelectContent>
              {kind === "orchestrator" && (
                <SelectItem value="none">No particular project</SelectItem>
              )}
              {eligible.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {kind !== "orchestrator" && eligible.length === 0 && (
            <p className="text-muted-foreground text-xs">
              This workspace has no projects on this machine yet.
            </p>
          )}
        </Field>
      )}

      <Field label="When">
        <Segmented
          label="When"
          value={preset}
          options={PRESETS.filter((p) => p.value !== "every" || frequent(kind))}
          onChange={(v) => {
            if (v === "custom") setCustom(cron);
            setPreset(v);
          }}
        />
        {preset === "custom" ? (
          <Input
            aria-label="Cron expression"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="min hour day month weekday"
            className="h-11 font-mono md:h-9"
          />
        ) : preset === "every" ? (
          <Select
            value={String(every)}
            onValueChange={(v) => setEvery(Number(v))}
          >
            <SelectTrigger aria-label="Interval" className="h-11 w-40 md:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...EVERY, every])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} minutes
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex flex-wrap gap-2">
            {preset === "weekly" && (
              <Select
                value={String(weekday)}
                onValueChange={(v) => setWeekday(Number(v))}
              >
                <SelectTrigger aria-label="Day" className="h-11 w-28 md:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {preset !== "hourly" && (
              <Select
                value={String(hour)}
                onValueChange={(v) => setHour(Number(v))}
              >
                <SelectTrigger aria-label="Hour" className="h-11 w-32 md:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {clock12(h, 0).replace(":00", "")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={String(minute)}
              onValueChange={(v) => setMinute(Number(v))}
            >
              <SelectTrigger aria-label="Minute" className="h-11 w-28 md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([...MINUTES, minute])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      :{String(m).padStart(2, "0")}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Input
          aria-label="Time zone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="text-muted-foreground h-11 md:h-8 md:text-xs"
        />
        <div className="bg-primary/[0.06] rounded-lg px-3 py-2.5 text-sm">
          {cronProblem || !tzOk ? (
            <p className="text-destructive">
              {cronProblem ?? `Unknown time zone "${timezone}"`}
            </p>
          ) : (
            <>
              <p className="font-medium">{describeCron(cron)}</p>
              {tooOften && (
                <p className="text-destructive mt-1 text-xs">
                  {kind === "message"
                    ? `A message goes at most every ${MESSAGE_MIN_GAP_MINUTES} minutes.`
                    : "A task or session runs at most once an hour. Post to the orchestrator for more often."}
                </p>
              )}
              <p className="text-muted-foreground mt-1 text-xs">Next runs</p>
              <ul className="mt-0.5 space-y-0.5 text-xs tabular-nums">
                {preview.map((t) => (
                  <li key={t}>{formatRunTime(t, timezone)}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Field>

      <Field label="Prompt">
        <Textarea
          aria-label="Prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the agent do each time?"
          rows={5}
        />
      </Field>

      {mutation.error && (
        <p className="text-destructive text-sm">{mutation.error.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-11 md:h-9"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-11 md:h-9"
          disabled={!ready || mutation.isPending}
        >
          {mutation.isPending
            ? "Saving..."
            : existing
              ? "Save"
              : "Create schedule"}
        </Button>
      </div>
    </form>
  );
}
