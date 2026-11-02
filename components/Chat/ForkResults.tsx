"use client";

import { GitFork, Quote, RotateCcw } from "lucide-react";
import { useForkChildren, type ChildView } from "@/data/fork";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { SessionAnchor } from "./SessionAnchor";
import { emptyNote, stateLabel, useRunAgain } from "./Forks";

const took = (c: ChildView) => {
  if (!c.startedAt || !c.settledAt) return null;
  const s = Math.max(1, Math.round((c.settledAt - c.startedAt) / 1000));
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

function Card({
  c,
  onQuote,
  again,
}: {
  c: ChildView;
  onQuote?: (text: string) => void;
  again: ReturnType<typeof useRunAgain>;
}) {
  const { text, tone } = stateLabel(c);
  const empty = c.outcome === "empty";
  const body = empty ? emptyNote(c) : (c.excerpt ?? c.summary ?? "");
  return (
    <section
      aria-label={`Fork ${c.n} result`}
      className="bg-card popover-surface space-y-2 rounded-2xl p-3"
    >
      <div className="flex items-center gap-2">
        <GitFork aria-hidden className="text-muted-foreground size-4" />
        <span className="text-muted-foreground font-mono text-[11px] tracking-wider uppercase">
          Fork {c.n}
        </span>
        <StatusPill tone={tone}>{text}</StatusPill>
        <span className="text-muted-foreground ml-auto text-xs">{took(c)}</span>
      </div>
      <p className="text-sm font-medium">{c.label.replace(/^\d+\.\s*/, "")}</p>
      <p
        className={
          empty
            ? "text-sm text-amber-600 dark:text-amber-400"
            : "text-muted-foreground line-clamp-6 text-sm whitespace-pre-wrap"
        }
      >
        {body}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" className="min-h-11">
          <SessionAnchor sessionId={c.id}>Open fork</SessionAnchor>
        </Button>
        {empty ? (
          <Button
            size="sm"
            variant="secondary"
            className="min-h-11"
            disabled={again.pending}
            onClick={() => again.run(c)}
          >
            <RotateCcw aria-hidden className="size-4" /> Run again
          </Button>
        ) : (
          onQuote &&
          body && (
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11"
              onClick={() => onQuote(c.excerpt ?? c.summary ?? "")}
            >
              <Quote aria-hidden className="size-4" /> Quote
            </Button>
          )
        )}
      </div>
    </section>
  );
}

// A delivery of fork results, as one card per fork in the parent's chat.
export function ForkResults({
  parent,
  ids,
  onQuote,
  fallback,
}: {
  parent: string;
  ids: string[];
  fallback: string;
  onQuote?: (text: string) => void;
}) {
  const { data } = useForkChildren(parent, true);
  const again = useRunAgain(parent);
  const cards = (data?.children ?? []).filter((c) => ids.includes(c.id));
  if (!cards.length)
    return <p className="text-muted-foreground text-xs">{fallback}</p>;
  return (
    <div className="flex flex-col gap-2">
      {cards.map((c) => (
        <Card key={c.id} c={c} onQuote={onQuote} again={again} />
      ))}
    </div>
  );
}
