"use client";

import { useState } from "react";
import { GitFork, Plus, Square } from "lucide-react";
import { toast } from "sonner";
import { useExperiment } from "@/data/experiments";
import { useClientConfig } from "@/data/client-config/queries";
import {
  useCancelForks,
  useForkChildren,
  useStartForks,
  type ChildView,
} from "@/data/fork";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SessionAnchor } from "./SessionAnchor";

type Tone = "amber" | "muted" | "green" | "primary" | "red";

export function stateLabel(c: ChildView): { text: string; tone: Tone } {
  if (c.state === "queued") return { text: "Waiting", tone: "muted" };
  if (c.state === "starting") return { text: "Starting", tone: "muted" };
  if (c.state === "running") return { text: "Working", tone: "primary" };
  if (c.state === "needs_input") return { text: "Needs you", tone: "amber" };
  if (c.outcome === "failed") return { text: "Failed", tone: "red" };
  if (c.outcome === "cancelled") return { text: "Stopped", tone: "muted" };
  return { text: "Done", tone: "green" };
}

function Row({
  c,
  onStop,
  stopping,
}: {
  c: ChildView;
  onStop: () => void;
  stopping: boolean;
}) {
  const { text, tone } = stateLabel(c);
  const open = c.state !== "settled";
  const note =
    c.summary ??
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
          <p className="text-muted-foreground truncate text-xs">
            {note}
            {c.resultKind === "implicit" && c.outcome === "ok"
              ? " · ended without reporting"
              : ""}
          </p>
        )}
      </div>
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

// "/fork": instructions for N copies of this session.
export function ForkDialog({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const start = useStartForks(sessionId);
  const max = useClientConfig().data?.forks?.maxPerFork ?? 8;
  const [texts, setTexts] = useState<string[]>([""]);
  const [worktree, setWorktree] = useState(false);
  const filled = texts.map((t) => t.trim()).filter(Boolean);
  const submit = () =>
    start.mutate(
      { instructions: filled, worktree },
      {
        onSuccess: (r) => {
          toast.success(
            `Started ${r.children.length} ${r.children.length === 1 ? "fork" : "forks"}`
          );
          setTexts([""]);
          setWorktree(false);
          onOpenChange(false);
        },
        onError: (e) => toast.error(e.message),
      }
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fork this session</DialogTitle>
          <DialogDescription>
            Each copy knows what this session knows and works in the background.
            You keep going; results are added to your next message.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {texts.map((t, i) => (
            <Textarea
              key={i}
              value={t}
              rows={2}
              aria-label={`Fork ${i + 1}`}
              placeholder={`What should fork ${i + 1} do?`}
              onChange={(e) =>
                setTexts(texts.map((x, j) => (j === i ? e.target.value : x)))
              }
            />
          ))}
          {texts.length < max && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={() => setTexts([...texts, ""])}
            >
              <Plus aria-hidden className="size-4" /> Another
            </Button>
          )}
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>
              Own checkout
              <span className="text-muted-foreground block text-xs">
                For forks that edit code. Off: they read this checkout and leave
                it alone.
              </span>
            </span>
            <Switch checked={worktree} onCheckedChange={setWorktree} />
          </label>
        </div>
        <DialogFooter>
          <Button
            className="min-h-11"
            disabled={!filled.length || start.isPending}
            onClick={submit}
          >
            {filled.length > 1 ? `Start ${filled.length} forks` : "Start fork"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
