"use client";

import { ArrowUpRight, Check, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeaturesQuery, useReleasePiece } from "@/data/features";
import type { FeatureView } from "@/lib/plans/view";
import { duration, money } from "@/components/Recipes/format";
import { sessionOpenActions } from "@/stores/sessionOpen";
import { tasksUiActions } from "@/stores/tasksUi";
import { cn } from "@/lib/utils";

function FeatureCard({ f }: { f: FeatureView }) {
  const release = useReleasePiece();
  if (f.status === "done")
    return (
      <p className="border-border/60 flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm">
        <Check className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="min-w-0 flex-1 truncate">
          {f.name} · {f.total} {f.total === 1 ? "PR" : "PRs"}
          {f.costUsd ? ` · ${money(f.costUsd)}` : ""}
          {f.durationMs ? ` · ${duration(f.durationMs)}` : ""}
        </span>
      </p>
    );
  return (
    <div
      className={cn(
        "border-border/60 space-y-1 rounded-xl border p-3",
        f.urgent && "border-amber-500/50"
      )}
    >
      <p className="text-sm font-medium">
        {f.name}{" "}
        <span className="text-muted-foreground font-normal">
          {f.merged}/{f.total} merged
        </span>
      </p>
      <ul>
        {f.pieces.map((p) => (
          <li
            key={p.id}
            className={cn(
              "flex min-h-11 items-center gap-2 text-xs md:min-h-8",
              p.status === "dropped" && "opacity-50"
            )}
          >
            <span className="w-4 shrink-0 tabular-nums">{p.position}</span>
            <span className="min-w-0 flex-1 truncate">
              {p.name} <span className="text-muted-foreground">· {p.line}</span>
            </span>
            {p.status === "blocked" && (
              <Button
                size="sm"
                variant="outline"
                className="h-11 md:h-8"
                disabled={release.isPending}
                onClick={() => release.mutate(p.id)}
              >
                Release anyway
              </Button>
            )}
            {p.sessionId && p.status !== "merged" && p.status !== "dropped" && (
              <button
                type="button"
                aria-label={`Open ${p.name}`}
                className="text-primary -mr-2 flex min-h-11 items-center px-2"
                onClick={() => {
                  sessionOpenActions.request(p.sessionId!);
                  tasksUiActions.setPanelOpen(false);
                }}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {release.error && (
        <p className="text-destructive text-xs">{release.error.message}</p>
      )}
    </div>
  );
}

// Plans that split into pieces: how far along, and what each waits on.
export function FeaturesSection() {
  const { data: features = [] } = useFeaturesQuery();
  if (!features.length) return null;
  return (
    <div className="space-y-2">
      <p className="label-mono text-muted-foreground flex items-center gap-1.5 pt-2">
        <Layers className="h-3 w-3" />
        Plans in pieces
      </p>
      {features.map((f) => (
        <FeatureCard key={f.id} f={f} />
      ))}
    </div>
  );
}
