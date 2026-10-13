"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Chat/Markdown";
import { useApprovePlan, useDropTask, usePlanEdits } from "@/data/tasks";
import type { PlanPieceView } from "@/lib/tasks/loop-types";
import type { TaskView } from "@/lib/tasks";
import { cn } from "@/lib/utils";

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];
const REASON: Record<string, string> = {
  a: "spans repositories",
  b: "must be live before the other can merge",
  c: "needs you mid-way",
  d: "must be revertible on its own",
};

function Piece({
  p,
  edits,
  busy,
  onEdit,
}: {
  p: PlanPieceView;
  edits: { merge: number[]; drop: number[] };
  busy: boolean;
  onEdit: (merge: number[], drop: number[]) => void;
}) {
  const mark = CIRCLED[p.position - 1];
  const off = p.edit !== null;
  const without = (list: number[]) => list.filter((n) => n !== p.position);
  return (
    <li className={cn("space-y-1 px-3 py-2.5", off && "opacity-60")}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {mark} {p.name}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {p.project}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">{p.slice.split("\n")[0]}</p>
      {p.afterPosition && (
        <p className="text-xs">
          after {CIRCLED[p.afterPosition - 1]} is {p.afterKind}
        </p>
      )}
      {p.reasons.length > 0 && (
        <p className="text-xs">
          {p.reasons.map((r) => `(${r}) ${REASON[r]}`).join("; ")}
        </p>
      )}
      {p.owns.length > 0 && (
        <p className="text-muted-foreground text-xs">
          owns: {p.owns.join(", ")}
        </p>
      )}
      {p.position > 1 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {off ? (
            <>
              <span className="bg-foreground/10 rounded-full px-2 py-0.5 text-[11px]">
                {p.edit === "merge"
                  ? `Merged into ${CIRCLED[p.position - 2]}`
                  : "Dropped"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-11 md:h-8"
                disabled={busy}
                onClick={() =>
                  onEdit(without(edits.merge), without(edits.drop))
                }
              >
                Undo
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-11 md:h-8"
                disabled={busy || p.forced}
                title={
                  p.forced ? "Split because it spans repositories" : undefined
                }
                onClick={() => onEdit([...edits.merge, p.position], edits.drop)}
              >
                Merge into {CIRCLED[p.position - 2]}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-11 md:h-8"
                disabled={busy}
                onClick={() => onEdit(edits.merge, [...edits.drop, p.position])}
              >
                Drop
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

// A plan waiting for a decision: how it splits, the plan itself, and
// Reject, Approve with a note, Approve.
export function PlanReview({ task }: { task: TaskView }) {
  const approve = useApprovePlan();
  const drop = useDropTask();
  const planEdits = usePlanEdits();
  const [showPlan, setShowPlan] = useState(false);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const pieces = task.plan?.pieces;
  const edits = {
    merge:
      pieces?.pieces.filter((p) => p.edit === "merge").map((p) => p.position) ??
      [],
    drop:
      pieces?.pieces.filter((p) => p.edit === "drop").map((p) => p.position) ??
      [],
  };
  const error =
    approve.error?.message || drop.error?.message || planEdits.error?.message;
  return (
    <div className="space-y-3">
      {pieces && pieces.pieces.length > 1 ? (
        <div className="space-y-1">
          <p className="label-mono text-muted-foreground">
            Pieces ({pieces.pieces.length})
          </p>
          <ul className="divide-border/60 border-border/60 divide-y rounded-lg border">
            {pieces.pieces.map((p) => (
              <Piece
                key={p.position}
                p={p}
                edits={edits}
                busy={planEdits.isPending}
                onEdit={(merge, dropped) =>
                  planEdits.mutate({ id: task.id, merge, drop: dropped })
                }
              />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">1 piece</p>
      )}
      {pieces?.folded.map((f) => (
        <p key={f.name} className="text-xs text-amber-700 dark:text-amber-300">
          &quot;{f.name}&quot; folded into {CIRCLED[f.into - 1]}: {f.why}
        </p>
      ))}
      {pieces?.warnings.map((w) => (
        <p key={w} className="text-xs text-amber-700 dark:text-amber-300">
          {w}
        </p>
      ))}
      <button
        type="button"
        aria-expanded={showPlan}
        className="text-primary min-h-11 text-xs font-medium md:min-h-8"
        onClick={() => setShowPlan((v) => !v)}
      >
        {showPlan ? "Hide the plan" : "Show the plan"}
      </button>
      {showPlan && (
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
      {noting && (
        <div className="space-y-2">
          <Textarea
            rows={3}
            value={note}
            placeholder="A change to the plan (recorded as a scope change)"
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            size="sm"
            className="h-11 md:h-8"
            disabled={approve.isPending || !note.trim()}
            onClick={() =>
              approve.mutate({ id: task.id, message: note.trim() })
            }
          >
            Approve with this note
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {rejecting ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-11 md:h-8"
            disabled={drop.isPending}
            onClick={() => drop.mutate(task.id)}
          >
            Drop this plan
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-11 md:h-8"
            onClick={() => setRejecting(true)}
          >
            Reject
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-11 md:h-8"
          aria-expanded={noting}
          onClick={() => setNoting((v) => !v)}
        >
          Approve with note…
        </Button>
        <Button
          size="sm"
          className="h-11 md:h-8"
          disabled={approve.isPending}
          onClick={() => approve.mutate({ id: task.id })}
        >
          {approve.isPending ? "Approving..." : "Approve"}
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
