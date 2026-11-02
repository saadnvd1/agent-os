"use client";

import { useState } from "react";
import { GitFork, Square } from "lucide-react";
import { toast } from "sonner";
import { useExperiment } from "@/data/experiments";
import {
  useCancelForks,
  useForkChildren,
  useStartForks,
  type ChildView,
} from "@/data/fork";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { SessionAnchor } from "./SessionAnchor";

type Tone = "amber" | "muted" | "green" | "primary" | "red";

export function stateLabel(c: ChildView): { text: string; tone: Tone } {
  if (c.state === "queued") return { text: "Waiting", tone: "muted" };
  if (c.state === "starting") return { text: "Starting", tone: "muted" };
  if (c.state === "running") return { text: "Working", tone: "primary" };
  if (c.state === "needs_input") return { text: "Needs you", tone: "amber" };
  if (c.outcome === "failed") return { text: "Failed", tone: "red" };
  if (c.outcome === "cancelled") return { text: "Stopped", tone: "muted" };
  if (c.outcome === "empty") return { text: "No result", tone: "amber" };
  return { text: "Done", tone: "green" };
}

// The strip's name for a fork: what was asked, else what was quoted, so a
// quote-first instruction isn't labelled with its "> ".
export const forkLabel = (typed: string, quote: string): string => {
  const line = (typed.trim() || quote.trim()).split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

// What a fork that ended with nothing to read says in place of a result.
export const emptyNote = (c: ChildView) =>
  c.summary && c.summary !== "ended without a result"
    ? `Ended with “${c.summary}”, not an answer`
    : "Ended without a result";

// Starts the same instruction again, for a fork that came back with nothing.
export function useRunAgain(sessionId: string) {
  const start = useStartForks(sessionId);
  return {
    pending: start.isPending,
    run: (c: ChildView) =>
      start.mutate(
        { instructions: [c.instruction], worktree: c.worktree },
        {
          onSuccess: () => toast.success("Started fork"),
          onError: (e) => toast.error(e.message),
        }
      ),
  };
}

function Row({
  c,
  onStop,
  stopping,
  again,
}: {
  c: ChildView;
  again: ReturnType<typeof useRunAgain>;
  onStop: () => void;
  stopping: boolean;
}) {
  const { text, tone } = stateLabel(c);
  const open = c.state !== "settled";
  const empty = c.outcome === "empty";
  const note =
    (empty ? emptyNote(c) : c.summary) ??
    (c.asks
      ? `Asks: ${c.asks}`
      : c.state === "queued"
        ? "Waiting for room"
        : null);
  return (
    <li className="flex min-h-11 items-center gap-2 px-3 py-1.5">
      <StatusPill tone={tone} className="shrink-0">
        {text}
      </StatusPill>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {c.n}. {c.label.replace(/^\d+\.\s*/, "")}
        </p>
        {note && (
          <p
            className={
              empty
                ? "truncate text-xs text-amber-600 dark:text-amber-400"
                : "text-muted-foreground truncate text-xs"
            }
          >
            {note}
            {c.resultKind === "implicit" && c.outcome === "ok"
              ? " · ended without reporting"
              : ""}
          </p>
        )}
      </div>
      {empty && (
        <button
          type="button"
          disabled={again.pending}
          onClick={() => again.run(c)}
          className="text-primary flex min-h-11 shrink-0 items-center px-2 text-sm"
        >
          Run again
        </button>
      )}
      <SessionAnchor
        sessionId={c.id}
        className="text-primary flex min-h-11 shrink-0 items-center px-2 text-sm"
      >
        Open
      </SessionAnchor>
      {open && (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Stop fork ${c.n}`}
          className="size-11 shrink-0"
          disabled={stopping}
          onClick={onStop}
        >
          <Square aria-hidden className="size-4" />
        </Button>
      )}
    </li>
  );
}

// Above the composer: this session's forks and where each stands.
export function ForksStrip({ sessionId }: { sessionId: string }) {
  const on = useExperiment("forks");
  const { data } = useForkChildren(sessionId, on);
  const cancel = useCancelForks(sessionId);
  const again = useRunAgain(sessionId);
  const [collapsed, setCollapsed] = useState(false);
  if (!on || !data) return null;
  if (data.asChild) return <ForkOfBanner info={data.asChild} />;
  const { children } = data;
  if (!children.length) return null;
  const open = children.filter((c) => c.state !== "settled").length;
  const stop = (ref?: string) =>
    cancel.mutate(ref ? { ref } : { all: true }, {
      onError: (e) => toast.error(e.message),
    });
  return (
    <section
      aria-label="Forks"
      className="bg-card popover-surface mb-2 overflow-hidden rounded-2xl"
    >
      <div className="flex min-h-11 items-center gap-2 px-3">
        <GitFork
          aria-hidden
          className="text-muted-foreground size-4 shrink-0"
        />
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
          className="min-h-11 min-w-0 flex-1 text-left text-sm font-medium"
        >
          Forks
          <span className="text-muted-foreground ml-2 font-normal">
            {open ? `${open} working` : "all done"} · {children.length} total
          </span>
        </button>
        {open > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11"
            disabled={cancel.isPending}
            onClick={() => stop()}
          >
            Stop all
          </Button>
        )}
      </div>
      {!collapsed && (
        <ul className="border-border max-h-60 divide-y overflow-y-auto border-t">
          {children.map((c) => (
            <Row
              key={c.id}
              c={c}
              stopping={cancel.isPending}
              again={again}
              onStop={() => stop(String(c.n))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ForkOfBanner({
  info,
}: {
  info: NonNullable<
    NonNullable<ReturnType<typeof useForkChildren>["data"]>["asChild"]
  >;
}) {
  return (
    <section
      aria-label="Fork of"
      className="bg-card popover-surface mb-2 flex min-h-11 items-center gap-2 rounded-2xl px-3 py-1.5"
    >
      <GitFork aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-sm">
        Fork {info.n} of{" "}
        <SessionAnchor sessionId={info.parentId} className="text-primary">
          {info.parentName}
        </SessionAnchor>
        <span className="text-muted-foreground block text-xs">
          {info.worktree
            ? "Works in its own checkout. "
            : "Reads the parent's checkout, doesn't change it. "}
          Finishes with a result for the parent.
        </span>
      </p>
    </section>
  );
}
