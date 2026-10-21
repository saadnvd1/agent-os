"use client";

import { useEffect, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { AlertTriangle, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useExportEstimate, type ExportEstimate } from "@/data/exports";
import { exportUi, exportUiActions } from "@/stores/exportUi";
import {
  COMPACT_RULES,
  EXPORT_FORMATS,
  formatBytes,
  redactionStatus,
  tokenLabel,
  type ExportFormat,
  type ExportMode,
  type ExportRequest,
} from "@/lib/export/view";
import { cn } from "@/lib/utils";
import { ExportActions } from "./ExportActions";
import { RangePicker } from "./RangePicker";
import { Seg } from "./Seg";
import { TurnSelectBar } from "./TurnSelectBar";

// Opened from a menu or a message: what to export (format, detail, turns,
// masking), what it comes to, and where it goes (copy, download, share).
export function ExportSheet() {
  const ui = useSnapshot(exportUi);
  return (
    <>
      <Dialog
        open={ui.open && !!ui.sessionId}
        onOpenChange={(open) => !open && exportUiActions.close()}
      >
        {ui.sessionId && (
          <SheetBody
            key={ui.sessionId}
            sessionId={ui.sessionId}
            title={ui.title}
          />
        )}
      </Dialog>
      {ui.selecting && <TurnSelectBar />}
    </>
  );
}

function SheetBody({ sessionId, title }: { sessionId: string; title: string }) {
  const { req, fromItemId } = useSnapshot(exportUi);
  const [est, setEst] = useState<ExportEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const estimate = useExportEstimate(sessionId);
  const seq = useRef(0);
  const wire = JSON.stringify(req);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const e = await estimate.mutateAsync(JSON.parse(wire) as ExportRequest);
        if (mine !== seq.current) return;
        setEst(e);
        setError(null);
        exportUi.turns = e.turns;
        const from = exportUi.fromItemId;
        if (from) {
          exportUi.fromItemId = null;
          const turn = e.turns.find((t) => t.id === from);
          if (turn)
            exportUiActions.setRequest({
              range: { from: turn.n, to: e.selected.of },
            });
        }
      } catch (err) {
        if (mine === seq.current) setError((err as Error).message);
      }
    }, 250);
    return () => clearTimeout(timer);
    // The mutation object changes every render; the request is the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wire, fromItemId]);

  const name = est?.title ?? title;
  const set = exportUiActions.setRequest;
  const size = est?.estimate[req.mode];
  const stale = estimate.isPending;
  const token = (m: ExportMode) =>
    est ? tokenLabel(est.estimate[m].tokens).replace("about ", "~") : " ";

  return (
    <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-3 rounded-none p-4 sm:h-auto sm:max-h-[90vh] sm:max-w-[560px] sm:rounded-lg">
      <div>
        <DialogTitle>Export for AI</DialogTitle>
        <DialogDescription className="truncate">{name}</DialogDescription>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <Section label="Format">
          <Seg<ExportFormat>
            label="Format"
            value={req.format}
            options={EXPORT_FORMATS.map((f) => ({ id: f.id, label: f.label }))}
            onChange={(format) => set({ format })}
          />
          <p className="text-muted-foreground text-xs">
            {EXPORT_FORMATS.find((f) => f.id === req.format)?.hint}
          </p>
        </Section>

        <Section label="Detail">
          <Seg<ExportMode>
            label="Detail"
            value={req.mode}
            options={[
              { id: "compact", label: "Compact", sub: token("compact") },
              { id: "full", label: "Full", sub: token("full") },
            ]}
            onChange={(mode) => set({ mode })}
          />
          <details className="text-muted-foreground text-xs">
            <summary className="flex min-h-8 cursor-pointer items-center">
              What Compact drops
            </summary>
            <ul className="list-disc space-y-0.5 pl-5">
              {COMPACT_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        </Section>

        <Section label="Range">
          <RangePicker
            range={req.range}
            est={est}
            onChange={(range) => set({ range })}
            onSelectInChat={() => exportUiActions.startSelect()}
          />
        </Section>

        <Section label="Masking">
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>Mask paths, machine names and emails</span>
            <Switch
              checked={req.redact === "all"}
              onCheckedChange={(on) => set({ redact: on ? "all" : "secrets" })}
            />
          </label>
          <p className="text-muted-foreground text-xs">
            Credentials are always masked.{" "}
            {est ? redactionStatus(est.hits) + "." : ""}
          </p>
        </Section>

        <div
          className={cn(
            "space-y-2 rounded-lg border p-3 text-sm",
            stale && "opacity-60"
          )}
          aria-live="polite"
        >
          <p className="font-medium">
            {size
              ? `${formatBytes(size.bytes)} · ${tokenLabel(size.tokens)}`
              : (error ?? "Working out the size…")}
          </p>
          {est?.warnings.map((w) => (
            <p
              key={w.code}
              className={cn(
                "flex gap-2 text-xs",
                w.level === "danger" && "text-destructive",
                w.level === "warn" && "text-amber-600 dark:text-amber-400",
                w.level === "info" && "text-muted-foreground"
              )}
            >
              {w.level === "info" ? (
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span>{w.text}</span>
            </p>
          ))}
        </div>
      </div>

      <ExportActions
        sessionId={sessionId}
        title={name}
        req={req as ExportRequest}
        est={est}
      />
    </DialogContent>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-medium">{label}</h3>
      {children}
    </section>
  );
}
