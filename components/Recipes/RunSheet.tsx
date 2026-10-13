"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { uuid } from "@/lib/uuid";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRunRecipe, usePreviewQuery } from "@/data/recipes";
import { MAX_NOTE, type RecipeView } from "@/lib/recipes/types";

// Run now: an optional one-off note, and what will be sent. The request id
// is made once per sheet, so a double tap starts one run.
export function RunSheet({
  recipe,
  onClose,
}: {
  recipe: RecipeView;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const requestId = useRef(uuid());
  const run = useRunRecipe();
  const preview = usePreviewQuery(recipe.id, note.trim(), showPrompt);
  const go = () =>
    run.mutate(
      {
        id: recipe.id,
        note: note.trim() || undefined,
        requestId: requestId.current,
      },
      { onSuccess: onClose }
    );
  return (
    <div className="border-border/60 bg-foreground/[0.03] space-y-3 rounded-xl border p-3">
      <label className="text-sm font-medium" htmlFor="run-note">
        Note for this run (optional)
      </label>
      <Textarea
        id="run-note"
        value={note}
        maxLength={MAX_NOTE}
        rows={2}
        placeholder="Includes #87"
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        type="button"
        aria-expanded={showPrompt}
        className="text-primary min-h-11 text-xs font-medium md:min-h-8"
        onClick={() => setShowPrompt((v) => !v)}
      >
        {showPrompt ? "Hide what it sends" : "Show what it sends"}
      </button>
      {showPrompt && (
        <pre className="bg-background max-h-64 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
          {preview.data?.prompt ?? (preview.error?.message || "Loading...")}
        </pre>
      )}
      {run.error && (
        <p className="text-destructive text-sm">{run.error.message}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-11 md:h-8"
          disabled={run.isPending || !!recipe.liveRun}
          onClick={go}
        >
          <Play className="h-3.5 w-3.5" />
          {run.isPending ? "Starting..." : "Run"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-11 md:h-8"
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
