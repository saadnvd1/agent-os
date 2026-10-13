"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { ArrowLeft, ChefHat, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useRecipeDraft,
  useRecipeQuery,
  useRecipesQuery,
} from "@/data/recipes";
import { useWorkspacesQuery } from "@/data/workspaces";
import { formatRunTime } from "@/lib/schedules/cron";
import type { RecipeView } from "@/lib/recipes/types";
import { recipesUi, recipesUiActions } from "@/stores/recipesUi";
import { RecipeForm } from "./RecipeForm";
import { RecipePage } from "./RecipePage";
import { RunChip } from "./RunChip";
import { money, sqlMs } from "./format";
import { useEffect } from "react";

type View =
  | { mode: "list" }
  | { mode: "detail"; id: string }
  | { mode: "form"; id?: string };

function Row({ r, onOpen }: { r: RecipeView; onOpen: () => void }) {
  const last = r.liveRun ?? r.lastRun;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-border/60 hover:bg-foreground/[0.03] focus-visible:ring-ring flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none focus-visible:ring-2"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{r.name}</span>
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {r.projectName}
          </span>
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {r.timer
            ? `${r.timer.description}${r.timer.enabled && r.timer.nextRunAt ? ` · next ${formatRunTime(r.timer.nextRunAt, r.timer.timezone)}` : ""}`
            : "No timer"}
          {last && ` · ${formatRunTime(sqlMs(last.created_at))}`}
          {r.totals.costUsd > 0 && ` · ${money(r.totals.costUsd)} total`}
        </p>
      </div>
      {last && <RunChip status={last.status} />}
    </button>
  );
}

// Loads the finished session's draft, then shows the form filled in.
function FromSession({
  sessionId,
  onCancel,
  onDone,
}: {
  sessionId: string;
  onCancel: () => void;
  onDone: (id: string) => void;
}) {
  const draft = useRecipeDraft();
  const { mutate } = draft;
  useEffect(() => mutate(sessionId), [mutate, sessionId]);
  if (draft.error)
    return <p className="text-destructive text-sm">{draft.error.message}</p>;
  if (!draft.data)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-xl" />;
  return (
    <RecipeForm
      workspaceId={recipesUi.workspaceId}
      draft={draft.data}
      sourceSessionId={sessionId}
      onDone={onDone}
      onCancel={onCancel}
    />
  );
}

function Edit({
  id,
  onDone,
  onCancel,
}: {
  id: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { data } = useRecipeQuery(id);
  return data ? (
    <RecipeForm
      workspaceId={null}
      existing={data.recipe}
      onDone={onDone}
      onCancel={onCancel}
    />
  ) : null;
}

// Settings > Recipes: saved jobs, one workspace's or every workspace's.
export function RecipesPanel() {
  const snap = useSnapshot(recipesUi);
  const [chosen, setView] = useState<View>({ mode: "list" });
  const view: View =
    chosen.mode !== "list"
      ? chosen
      : snap.fromSessionId
        ? { mode: "form" }
        : snap.recipeId
          ? { mode: "detail", id: snap.recipeId }
          : chosen;
  const { data: recipes = [], isPending } = useRecipesQuery(
    snap.workspaceId,
    true
  );
  const { data: workspaces = [] } = useWorkspacesQuery();
  const wsName = workspaces.find((w) => w.id === snap.workspaceId)?.name;

  const toList = () => {
    recipesUiActions.clear();
    setView({ mode: "list" });
  };
  const toDetail = (id: string) => {
    recipesUiActions.clear();
    setView({ mode: "detail", id });
  };

  return (
    <div className="space-y-4 [&>*]:min-w-0">
      <div className="flex items-center gap-2">
        {view.mode !== "list" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            className="-ml-2 h-11 w-11 md:h-8 md:w-8"
            onClick={() =>
              view.mode === "form" && view.id ? toDetail(view.id) : toList()
            }
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {view.mode === "form"
            ? view.id
              ? "Edit recipe"
              : snap.fromSessionId
                ? "Save as recipe"
                : "New recipe"
            : wsName
              ? `In ${wsName}`
              : "In every workspace"}
        </h3>
        {view.mode === "list" && (
          <Button
            size="sm"
            className="h-11 md:h-8"
            onClick={() => setView({ mode: "form" })}
          >
            <Plus className="h-4 w-4" />
            New
          </Button>
        )}
      </div>
      {view.mode === "list" && (
        <div className="space-y-2">
          {isPending &&
            [0, 1].map((i) => (
              <div
                key={i}
                className="bg-muted/40 h-14 animate-pulse rounded-xl"
              />
            ))}
          {!isPending && recipes.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ChefHat className="text-primary h-6 w-6" />
              <p className="text-muted-foreground max-w-xs text-sm">
                No recipes yet. A recipe saves a job that comes up again, like a
                build or an audit. Each run is a fresh task or session that
                knows what the last one reported.
              </p>
            </div>
          )}
          {recipes.map((r) => (
            <Row key={r.id} r={r} onOpen={() => toDetail(r.id)} />
          ))}
        </div>
      )}
      {view.mode === "detail" && (
        <RecipePage
          key={view.id}
          id={view.id}
          openRun={snap.runRecipeId === view.id}
          onEdit={() => setView({ mode: "form", id: view.id })}
          onGone={toList}
        />
      )}
      {view.mode === "form" && view.id && (
        <Edit
          id={view.id}
          onDone={toDetail}
          onCancel={() => toDetail(view.id!)}
        />
      )}
      {view.mode === "form" && !view.id && snap.fromSessionId && (
        <FromSession
          sessionId={snap.fromSessionId}
          onDone={toDetail}
          onCancel={toList}
        />
      )}
      {view.mode === "form" && !view.id && !snap.fromSessionId && (
        <RecipeForm
          workspaceId={snap.workspaceId}
          onDone={toDetail}
          onCancel={toList}
        />
      )}
    </div>
  );
}
