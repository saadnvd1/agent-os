"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Hand,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useGenerateReport, useTaskMode, useTaskReport } from "@/data/reports";
import {
  MODE_COPY,
  type EvidenceRef,
  type HealthReport,
  type LineTone,
} from "@/lib/reports/types";
import { DraftCard } from "./DraftCard";
import { EstimateBar } from "./EstimateBar";
import { EvidenceSheet } from "./EvidenceSheet";
import { ModeChooser } from "./ModeChooser";

const TONES: Record<LineTone, { icon: LucideIcon; cls: string; word: string }> =
  {
    done: {
      icon: CheckCircle2,
      cls: "text-green-600 dark:text-green-400",
      word: "Done",
    },
    warn: {
      icon: AlertTriangle,
      cls: "text-amber-600 dark:text-amber-400",
      word: "Needs attention",
    },
    blocked: {
      icon: Hand,
      cls: "text-red-600 dark:text-red-400",
      word: "Blocked",
    },
    next: { icon: ArrowRight, cls: "text-primary", word: "Next" },
  };

const STATE_TONE = {
  merged: "green",
  done: "green",
  working: "primary",
  review: "primary",
  "checks-failing": "red",
  blocked: "red",
} as const;

const when = (iso: string) =>
  new Date(
    iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`
  ).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

// A task's plain-English health report: what's done, what needs attention,
// what's next, each line backed by evidence that opens underneath.
export function ReportView({
  sessionId,
  name,
}: {
  sessionId: string;
  name?: string;
}) {
  const { data, isPending, isError, error } = useTaskReport(sessionId);
  const generate = useGenerateReport(sessionId);
  const setMode = useTaskMode(sessionId);
  const [open, setOpen] = useState<EvidenceRef | null>(null);
  const [changingMode, setChangingMode] = useState(false);
  const asked = useRef(false);

  const report = data?.report ?? null;
  // Opening the view builds the first report, or a fresh one when the head moved.
  useEffect(() => {
    if (!data || asked.current || data.generating) return;
    if (!report || report.stale) {
      asked.current = true;
      generate.mutate();
    }
  }, [data, report, generate]);

  if (isPending)
    return <div className="bg-muted/40 m-4 h-40 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive p-4 text-sm">{error.message}</p>;

  const mode = data.mode;
  const busy = data.generating || generate.isPending;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-4">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Your Project Progress</h2>
            {report && (
              <StatusPill
                tone={
                  STATE_TONE[report.state as keyof typeof STATE_TONE] ?? "muted"
                }
              >
                {report.state.replace("-", " ")}
              </StatusPill>
            )}
            <button
              type="button"
              onClick={() => setChangingMode((c) => !c)}
              aria-expanded={changingMode}
              className="bg-secondary ml-auto inline-flex min-h-11 items-center rounded-lg px-3 text-xs"
            >
              {MODE_COPY[mode.mode].label}
              {mode.source === "task" ? " · this task" : ""}
            </button>
          </div>
          {name && (
            <p className="text-muted-foreground truncate text-sm">{name}</p>
          )}
          {changingMode && (
            <div className="bg-muted/40 space-y-2 rounded-lg p-3">
              <ModeChooser
                mode={mode.mode}
                onChange={(m) => setMode.mutate(m)}
                disabled={setMode.isPending}
              />
              {mode.source === "task" && (
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setMode.mutate(null)}
                >
                  Use the workspace default
                </Button>
              )}
            </div>
          )}
        </header>

        {!report ? (
          <div className="bg-card space-y-3 rounded-xl p-5 text-center shadow-sm">
            <p className="text-sm">
              {busy
                ? "Reading the evidence…"
                : "No report has been built for this task yet."}
            </p>
            {busy ? (
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            ) : (
              <Button className="min-h-11" onClick={() => generate.mutate()}>
                Build the report
              </Button>
            )}
          </div>
        ) : (
          <ReportBody
            report={report}
            sessionId={sessionId}
            mode={mode.mode}
            busy={busy}
            onRefresh={() => generate.mutate()}
            onOpen={setOpen}
          />
        )}
      </div>
      <EvidenceSheet
        evidence={open}
        stale={!!open?.sha && !!report?.head && open.sha !== report.head}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

function ReportBody({
  report,
  sessionId,
  mode,
  busy,
  onRefresh,
  onOpen,
}: {
  report: HealthReport;
  sessionId: string;
  mode: string;
  busy: boolean;
  onRefresh: () => void;
  onOpen: (e: EvidenceRef) => void;
}) {
  const byId = new Map(report.evidence.map((e) => [e.id, e]));
  const chips = (ids: string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((e): e is EvidenceRef => !!e)
      .map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onOpen(e)}
          className="bg-secondary text-muted-foreground hover:text-foreground relative max-w-full truncate rounded-md px-2 py-0.5 text-[11px] before:absolute before:inset-x-0 before:-inset-y-3"
        >
          {e.label}
        </button>
      ));

  return (
    <>
      {report.stale && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          New work was pushed since this report.
        </p>
      )}
      <section className="bg-card space-y-4 rounded-xl p-4 shadow-sm">
        <EstimateBar estimate={report.estimate} />
        <p className="text-base font-medium">{report.headline}</p>
        <ul className="space-y-3">
          {report.lines.map((l) => {
            const t = TONES[l.tone];
            return (
              <li key={l.id} className="flex gap-3">
                <t.icon
                  className={`mt-0.5 h-5 w-5 shrink-0 ${t.cls}`}
                  aria-label={t.word}
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-sm">{l.text}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {chips(l.evidence)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {report.recommendation && (
        <section className="bg-card space-y-2 rounded-xl p-4 shadow-sm">
          <h3 className="text-sm font-semibold">Analyst recommendation</h3>
          <p className="text-sm">{report.recommendation.text}</p>
          <div className="flex flex-wrap gap-1.5">
            {chips(report.recommendation.evidence)}
          </div>
        </section>
      )}

      {report.draft && mode !== "manual" && (
        <DraftCard
          key={`${report.draft.source}:${report.draft.id}`}
          sessionId={sessionId}
          draft={report.draft}
        />
      )}

      <footer className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>
          Built from {report.evidence.length} item
          {report.evidence.length === 1 ? "" : "s"} · {when(report.createdAt)}
          {report.source === "model" && report.model
            ? ` · ${report.model}`
            : " · no model"}
        </span>
        {report.dropped > 0 && (
          <span>
            {report.dropped} unsupported claim{report.dropped === 1 ? "" : "s"}{" "}
            left out
          </span>
        )}
        <Button
          variant="ghost"
          className="ml-auto min-h-11"
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </footer>
    </>
  );
}
