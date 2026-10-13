"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useProjectsQuery } from "@/data/projects";
import { useWorkspacesQuery } from "@/data/workspaces";
import {
  useCreateRecipe,
  useUpdateRecipe,
  type RecipeFormInput,
} from "@/data/recipes";
import type { RecipeDraft } from "@/lib/recipes/draft";
import {
  MAX_BRIEF,
  MAX_NAME,
  type RecipeKind,
  type RecipeView,
} from "@/lib/recipes/types";
import {
  TimerFields,
  timerCron,
  timerProblem,
  timerValue,
  type TimerValue,
} from "./TimerFields";

const KINDS: { value: RecipeKind; label: string; hint: string }[] = [
  {
    value: "task",
    label: "Task",
    hint: "Ends in a PR and goes through the gates",
  },
  { value: "session", label: "Session", hint: "Changes no code and has no PR" },
];

// A new recipe, an edit, or "Save as recipe" from a finished session
// (`draft`): the brief can be swapped for a cleaned-up one first.
export function RecipeForm({
  workspaceId,
  existing,
  draft,
  sourceSessionId,
  onDone,
  onCancel,
}: {
  workspaceId: string | null;
  existing?: RecipeView;
  draft?: RecipeDraft | null;
  sourceSessionId?: string | null;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { data: workspaces = [] } = useWorkspacesQuery();
  const { data: projects = [] } = useProjectsQuery();
  const create = useCreateRecipe();
  const update = useUpdateRecipe();
  const mutation = existing ? update : create;

  const [name, setName] = useState(existing?.name ?? draft?.name ?? "");
  const [kind, setKind] = useState<RecipeKind>(
    existing?.kind ?? draft?.kind ?? "task"
  );
  const [brief, setBrief] = useState(existing?.brief ?? draft?.prompt ?? "");
  const [suggested, setSuggested] = useState(draft?.draft ?? null);
  const [projectId, setProjectId] = useState(
    existing?.project_id ?? draft?.projectId ?? ""
  );
  const [timer, setTimer] = useState<TimerValue>(() =>
    timerValue(existing?.timer ?? null)
  );

  const workspace =
    existing?.workspace_id ??
    draft?.workspaceId ??
    workspaceId ??
    workspaces[0]?.id ??
    "";
  const eligible = projects.filter(
    (p) =>
      !p.is_uncategorized &&
      p.workspace_id === workspace &&
      (!p.host_id || p.host_id === "local")
  );
  const project =
    eligible.find((p) => p.id === projectId)?.id ?? eligible[0]?.id ?? "";
  const problem = timerProblem(timer);
  const ready = !!name.trim() && !!brief.trim() && !!project && !problem;

  const save = () => {
    const cron = timerCron(timer);
    const timerInput: RecipeFormInput["timer"] = cron
      ? { cron, timezone: timer.timezone }
      : null;
    if (existing)
      update.mutate(
        {
          id: existing.id,
          name: name.trim(),
          kind,
          brief: brief.trim(),
          projectId: project,
          timer: timerInput,
        },
        { onSuccess: () => onDone(existing.id) }
      );
    else
      create.mutate(
        {
          workspaceId: workspace,
          projectId: project,
          name: name.trim(),
          kind,
          brief: brief.trim(),
          sourceSessionId: sourceSessionId ?? null,
          timer: timerInput,
        },
        { onSuccess: ({ recipe }) => onDone(recipe.id) }
      );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="recipe-name">
          Name
        </label>
        <Input
          id="recipe-name"
          value={name}
          maxLength={MAX_NAME}
          placeholder="TestFlight build"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="recipe-project">
          Project
        </label>
        <select
          id="recipe-project"
          className="border-input bg-background min-h-11 w-full rounded-md border px-2 text-sm md:min-h-9"
          value={project}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Each run is a</p>
        <div
          role="radiogroup"
          aria-label="Kind"
          className="bg-foreground/[0.04] grid grid-cols-2 gap-1 rounded-lg p-1"
        >
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                "min-h-11 rounded-md px-2 text-sm font-medium md:min-h-8",
                kind === k.value
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          {KINDS.find((k) => k.value === kind)?.hint}
        </p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="recipe-brief">
          Brief
        </label>
        {suggested && (
          <div className="border-primary/30 bg-primary/5 space-y-2 rounded-lg border p-3">
            <p className="text-xs font-medium">Suggested brief</p>
            <p className="text-sm whitespace-pre-wrap">{suggested.brief}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-11 md:h-8"
                onClick={() => {
                  setBrief(suggested.brief);
                  setSuggested(null);
                }}
              >
                Use this
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-11 md:h-8"
                onClick={() => setSuggested(null)}
              >
                Keep original
              </Button>
            </div>
          </div>
        )}
        <Textarea
          id="recipe-brief"
          rows={8}
          maxLength={MAX_BRIEF}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          Keep it short: what to run and how to judge it. The steps belong in a
          script in the repo.
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Timer</p>
        <TimerFields value={timer} onChange={setTimer} />
      </div>
      {mutation.error && (
        <p className="text-destructive text-sm">{mutation.error.message}</p>
      )}
      <div className="flex gap-2">
        <Button
          className="h-11 md:h-9"
          disabled={!ready || mutation.isPending}
          onClick={save}
        >
          {mutation.isPending
            ? "Saving..."
            : existing
              ? "Save"
              : "Create recipe"}
        </Button>
        <Button variant="ghost" className="h-11 md:h-9" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
