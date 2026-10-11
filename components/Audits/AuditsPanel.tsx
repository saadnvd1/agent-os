"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Chat/Markdown";
import {
  useAuditReportQuery,
  useAuditsQuery,
  type AuditRef,
} from "@/data/audits";
import type { AuditListItem } from "@/lib/session-audit/store";

const tokens = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : `${Math.round(n / 1e3)}k`;

const day = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function stats(a: AuditListItem): string {
  if (a.kind !== "sessions")
    return a.findings === undefined
      ? a.title
      : `${a.title} · ${a.findings} findings`;
  return `${a.sessions ?? 0} sessions · ${tokens(a.tokensRead ?? 0)} tokens · ${a.findings ?? 0} findings`;
}

function AuditRow({
  audit,
  onOpen,
}: {
  audit: AuditListItem;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-audit={`${audit.kind}/${audit.id}`}
      className="border-border/60 hover:bg-foreground/[0.03] focus-visible:ring-ring flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none focus-visible:ring-2"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 flex-col gap-0.5 md:flex-row md:items-center md:gap-2">
          <span className="flex shrink-0 items-center gap-2 text-sm font-medium">
            {day(audit.at)}
            {audit.kind !== "sessions" && (
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px] font-normal">
                {audit.kind}
              </span>
            )}
          </span>
          <span className="text-muted-foreground truncate text-[11px]">
            {stats(audit)}
          </span>
        </div>
        {audit.headline && (
          <p className="text-muted-foreground truncate text-xs">
            {audit.headline}
          </p>
        )}
      </div>
      <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
    </button>
  );
}

function AuditReport({
  audit,
  onBack,
}: {
  audit: AuditRef;
  onBack: () => void;
}) {
  const report = useAuditReportQuery(audit);
  // The list scrolled the Settings pane and its row is gone: start the
  // report at its top, with focus on the way back.
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.closest("section")?.scrollTo({ top: 0 });
    backRef.current?.focus({ preventScroll: true });
  }, [audit]);
  return (
    <div className="space-y-3">
      <Button
        ref={backRef}
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="-ml-2 min-h-11"
      >
        <ArrowLeft className="h-4 w-4" />
        All audits
      </Button>
      {report.isLoading ? (
        <div className="bg-muted/40 h-32 animate-pulse rounded-xl" />
      ) : report.error ? (
        <p className="text-destructive text-sm">{report.error.message}</p>
      ) : (
        <div className="text-sm">
          <Markdown text={report.data ?? ""} />
        </div>
      )}
    </div>
  );
}

/**
 * Session audits: where tokens and repeated work went across the sessions
 * AgentOS started. `/session-audit` writes them to this machine only.
 */
export function AuditsPanel() {
  const audits = useAuditsQuery();
  const [open, setOpen] = useState<AuditRef | null>(null);
  // Back returns focus to the row that opened the report.
  const listRef = useRef<HTMLDivElement>(null);
  const lastOpen = useRef<AuditRef | null>(null);
  useEffect(() => {
    if (open) {
      lastOpen.current = open;
      return;
    }
    const was = lastOpen.current;
    if (!was) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-audit="${was.kind}/${was.id}"]`)
      ?.focus();
  }, [open]);

  if (open) return <AuditReport audit={open} onBack={() => setOpen(null)} />;
  if (audits.isLoading)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-xl" />;
  if (audits.error)
    return <p className="text-destructive text-sm">{audits.error.message}</p>;
  if (!audits.data?.length)
    return (
      <p className="text-muted-foreground text-sm">
        No audits yet. Run <code>/session-audit</code> in a session on this
        project to audit what your sessions spent and repeated.
      </p>
    );
  return (
    <div ref={listRef} className="space-y-2">
      {audits.data.map((a) => (
        <AuditRow
          key={`${a.kind}/${a.id}`}
          audit={a}
          onOpen={() => setOpen({ kind: a.kind, id: a.id })}
        />
      ))}
    </div>
  );
}
