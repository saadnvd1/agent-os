"use client";

import { useState } from "react";
import { BookmarkPlus, ChefHat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recipesUiActions } from "@/stores/recipesUi";
import { useApplyCard, useLearningCards } from "@/data/learning-cards";
import type {
  Card,
  LessonPayload,
  RecipePayload,
} from "@/lib/learning-cards/types";

export function destinationLabel(p: LessonPayload): string {
  switch (p.destination) {
    case "recipe":
      return `Recipe brief: ${p.recipeName ?? "this recipe"}`;
    case "claude_md":
      return `CLAUDE.md in ${p.projectName ?? "the project"}, through a PR`;
    case "check":
      return "Start a task to build a check";
    case "rule":
      return "Workspace rule";
  }
}

function RecipeRow({
  card,
  busy,
  onSave,
  onEdit,
  onDismiss,
}: {
  card: Card;
  busy: boolean;
  onSave: (brief: string) => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  const p = card.payload as RecipePayload;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ChefHat className="text-muted-foreground h-3.5 w-3.5" />
        Save as recipe?
      </div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`text-muted-foreground text-left text-xs whitespace-pre-wrap ${open ? "" : "line-clamp-3"}`}
      >
        {p.brief}
      </button>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          className="h-11 md:h-8"
          disabled={busy}
          onClick={() => onSave(p.brief)}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-11 md:h-8"
          disabled={busy}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground h-11 md:h-8"
          disabled={busy}
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function LessonRow({
  card,
  busy,
  onApply,
  onDismiss,
}: {
  card: Card;
  busy: boolean;
  onApply: (edits: { lesson: string; taskPrompt?: string }) => void;
  onDismiss: () => void;
}) {
  const p = card.payload as LessonPayload;
  const [lesson, setLesson] = useState(p.lesson);
  const [task, setTask] = useState(p.taskPrompt ?? "");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BookmarkPlus className="text-muted-foreground h-3.5 w-3.5" />
        Keep this for next time?
      </div>
      {p.destination === "check" ? (
        <textarea
          aria-label="Task to start"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          className="bg-background border-border w-full rounded-lg border p-2 text-xs"
        />
      ) : (
        <input
          aria-label="Lesson"
          value={lesson}
          maxLength={200}
          onChange={(e) => setLesson(e.target.value)}
          className="bg-background border-border h-11 w-full rounded-lg border px-2 text-xs md:h-8"
        />
      )}
      <p className="text-muted-foreground text-xs">{destinationLabel(p)}</p>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          className="h-11 md:h-8"
          disabled={
            busy || !(p.destination === "check" ? task.trim() : lesson.trim())
          }
          onClick={() => onApply({ lesson, taskPrompt: task })}
        >
          Apply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground h-11 md:h-8"
          disabled={busy}
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function LearningCards({
  cards,
  embedded = false,
  busy = false,
  onApply,
  onDismiss,
  onEditRecipe,
}: {
  cards: Card[];
  // Inside another surface (the Needs-you strip): no frame of its own.
  embedded?: boolean;
  busy?: boolean;
  onApply: (
    id: number,
    edits: { lesson?: string; brief?: string; taskPrompt?: string }
  ) => void;
  onDismiss: (id: number) => void;
  onEditRecipe: (sessionId: string) => void;
}) {
  if (!cards.length) return null;
  return (
    <div
      role="region"
      aria-label="Learning cards"
      className={
        embedded
          ? "flex flex-col gap-3 px-3 pt-1 pb-3"
          : "bg-card popover-surface mb-2 flex flex-col gap-3 rounded-2xl p-3"
      }
    >
      {cards.map((c) =>
        c.kind === "recipe" ? (
          <RecipeRow
            key={c.id}
            card={c}
            busy={busy}
            onSave={(brief) => onApply(c.id, { brief })}
            onEdit={() => onEditRecipe(c.session_id)}
            onDismiss={() => onDismiss(c.id)}
          />
        ) : (
          <LessonRow
            key={c.id}
            card={c}
            busy={busy}
            onApply={(edits) => onApply(c.id, edits)}
            onDismiss={() => onDismiss(c.id)}
          />
        )
      )}
    </div>
  );
}

// On a finished session, above the composer. Nothing while the experiment is off.
export function LearningCardsHost({
  sessionId,
  only,
  embedded,
}: {
  sessionId: string;
  // Just this card.
  only?: number;
  embedded?: boolean;
}) {
  const { data } = useLearningCards(sessionId);
  const { apply, dismiss, isPending } = useApplyCard();
  return (
    <LearningCards
      embedded={embedded}
      cards={(data ?? []).filter((c) => only === undefined || c.id === only)}
      busy={isPending}
      onApply={apply}
      onDismiss={dismiss}
      onEditRecipe={(id) => recipesUiActions.saveSessionAs(id)}
    />
  );
}
