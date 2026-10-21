"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CircleDashed,
  CircleX,
  Pause,
  Play,
  Send,
  SkipForward,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusPill } from "@/components/ui/status-pill";
import {
  useEditLoop,
  useNextInstruction,
  useRunLoop,
  useStopLoop,
} from "@/data/loops";
import type { Criterion, CycleRow, LoopView as View } from "@/lib/loops/types";
import { STOP_LABEL, minutesText } from "./labels";

const CYCLE_LABEL: Record<CycleRow["state"], string> = {
  claimed: "Gathering evidence",
  decided: "Analyst decided",
  counting: "Sending soon",
  sending: "Sending",
  sent: "Sent",
  skipped: "Nothing to send",
  stopped: "Stopped",
  superseded: "You took over",
  error: "Error",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-foreground/[0.04] min-w-0 rounded-lg px-3 py-2">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CriterionRow({
  c,
  canEdit,
  onWaive,
}: {
  c: Criterion;
  canEdit: boolean;
  onWaive: () => void;
}) {
  const Icon =
    c.status === "met"
      ? Check
      : c.status === "failing"
        ? CircleX
        : CircleDashed;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          c.status === "met"
            ? "text-emerald-500"
            : c.status === "failing"
              ? "text-red-500"
              : "text-muted-foreground"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p
          className={
            c.status === "waived" ? "text-muted-foreground line-through" : ""
          }
        >
          {c.text}
        </p>
        {c.evidence && (
          <p className="text-muted-foreground font-mono text-[11px] break-words">
            {c.evidence.kind}: {c.evidence.ref}
            {c.evidence.note && ` · ${c.evidence.note}`}
            {c.status === "met" && !c.verified && " · unverified"}
          </p>
        )}
      </div>
      {canEdit && c.status !== "met" && c.status !== "waived" && (
        <Button
          size="sm"
          variant="ghost"
          className="h-11 md:h-8"
          onClick={onWaive}
        >
          Waive
        </Button>
      )}
    </li>
  );
}

function NextBar({ taskId, cycle }: { taskId: string; cycle: CycleRow }) {
  const next = useNextInstruction(taskId);
  const [now, setNow] = useState(() => Date.now());
  const [text, setText] = useState(cycle.instruction ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = cycle.sendAt
    ? Math.max(0, Math.ceil((cycle.sendAt - now) / 1000))
    : null;
  return (
    <div className="bg-primary/10 space-y-2 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Next instruction</h3>
        <span className="text-muted-foreground text-xs tabular-nums">
          {left === null ? "held" : `sends in ${left}s`}
        </span>
      </div>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          aria-label="Next instruction"
          className="bg-background/60 w-full rounded-lg p-2 text-sm outline-none"
        />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{cycle.instruction}</p>
      )}
      {next.error && (
        <p className="text-xs text-red-500">{next.error.message}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="h-11 md:h-8"
          disabled={next.isPending}
          onClick={() =>
            next.mutate({
              action: "send",
              instruction: editing ? text : undefined,
            })
          }
        >
          <Send /> Send now
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-11 md:h-8"
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? "Done editing" : "Edit"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-11 md:h-8"
          onClick={() => next.mutate({ action: "hold" })}
        >
          <Pause /> Hold
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-11 md:h-8"
          onClick={() => next.mutate({ action: "skip" })}
        >
          <SkipForward /> Skip
        </Button>
      </div>
    </div>
  );
}

function Cycle({ c }: { c: CycleRow }) {
  const ev = c.evidence;
  return (
    <li className="bg-foreground/[0.03] space-y-1.5 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Cycle {c.n}</h4>
        <StatusPill tone={c.state === "error" ? "amber" : "muted"}>
          {CYCLE_LABEL[c.state]}
        </StatusPill>
      </div>
      {ev && (
        <div className="flex flex-wrap gap-1.5">
          {ev.commands.map((cmd) => (
            <StatusPill
              key={cmd.name}
              tone={cmd.exitCode === 0 ? "muted" : "amber"}
            >
              {cmd.name}{" "}
              {cmd.skipped
                ? "skipped"
                : cmd.exitCode === 0
                  ? "passed"
                  : `${cmd.failed.length || cmd.errors.length} failing`}
            </StatusPill>
          ))}
          {!c.changed && <StatusPill tone="muted">no change</StatusPill>}
        </div>
      )}
      {c.analysis?.summary && <p className="text-sm">{c.analysis.summary}</p>}
      {c.analysis?.findings.map((f, i) => (
        <p key={i} className="text-muted-foreground text-xs break-words">
          {f.severity === "blocking" ? "Blocking" : "Minor"}: {f.text}
          {f.file && (
            <span className="font-mono">
              {" "}
              ({f.file}
              {f.line ? `:${f.line}` : ""})
            </span>
          )}
        </p>
      ))}
      {c.instructionSent && (
        <p className="text-xs break-words">
          <span className="text-muted-foreground">
            {c.sender === "user" ? "You sent: " : "Sent: "}
          </span>
          {c.instructionSent}
        </p>
      )}
      {!c.instructionSent && c.instruction && c.state !== "counting" && (
        <p className="text-muted-foreground text-xs break-words">
          Not sent: {c.instruction}
        </p>
      )}
      {c.error && <p className="text-xs break-words text-red-500">{c.error}</p>}
    </li>
  );
}

export function LoopView({ taskId, view }: { taskId: string; view: View }) {
  const stop = useStopLoop(taskId);
  const run = useRunLoop(taskId);
  const edit = useEditLoop(taskId);
  const { loop, criteria, cycles } = view;
  const live = loop.state === "running";
  const met = criteria.filter(
    (c) => c.status === "met" || c.status === "waived"
  ).length;
  const counting = cycles.find((c) => c.state === "counting" && c.instruction);
  const limitStop = loop.stopReason?.startsWith("limit:");
  const error =
    stop.error?.message ?? run.error?.message ?? edit.error?.message;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Criteria" value={`${met}/${criteria.length}`} />
        <Stat label="Cycles" value={`${cycles[0]?.n ?? 0}/${loop.maxCycles}`} />
        <Stat
          label="Spend"
          value={`$${view.spentUsd.toFixed(2)} / $${loop.maxCostUsd}`}
        />
        <Stat label="Elapsed" value={minutesText(view.elapsedMs)} />
      </div>
      {!live && loop.stopReason && (
        <Notice
          tone={
            loop.stopReason === "done" || loop.stopReason === "stopped"
              ? "info"
              : "warning"
          }
          action={
            limitStop ? (
              <Button
                size="sm"
                className="h-11 md:h-8"
                disabled={edit.isPending}
                onClick={() =>
                  edit.mutate({
                    extend: { cycles: 4, costUsd: 5, minutes: 60 },
                  })
                }
              >
                Continue
              </Button>
            ) : undefined
          }
        >
          <p className="font-medium">{STOP_LABEL[loop.stopReason]}</p>
          {loop.stopDetail && loop.stopReason !== "stopped" && (
            <p className="text-muted-foreground">{loop.stopDetail}</p>
          )}
        </Notice>
      )}
      {live && view.holdReason && <Notice>{view.holdReason}</Notice>}
      {live && counting && (
        <NextBar key={counting.id} taskId={taskId} cycle={counting} />
      )}
      {error && <Notice tone="warning">{error}</Notice>}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Acceptance checklist</h3>
        <ul className="space-y-2">
          {criteria.map((c) => (
            <CriterionRow
              key={c.id}
              c={c}
              canEdit={live}
              onWaive={() => edit.mutate({ waive: [c.id] })}
            />
          ))}
        </ul>
      </section>
      {live && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-11 md:h-8"
            disabled={run.isPending}
            onClick={() => run.mutate()}
          >
            <Play /> Run a cycle now
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-11 md:h-8"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            <Square /> Stop loop
          </Button>
        </div>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Cycles</h3>
        {cycles.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            The first cycle starts when the coding agent finishes a turn.
          </p>
        ) : (
          <ul className="space-y-2">
            {cycles.map((c) => (
              <Cycle key={c.id} c={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
