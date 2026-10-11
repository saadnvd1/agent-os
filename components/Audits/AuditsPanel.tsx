"use client";

import { useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Chat/Markdown";
import { useAuditReportQuery, useAuditsQuery } from "@/data/audits";
import type { AuditIndexEntry } from "@/lib/session-audit/store";

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

function AuditRow({
  audit,
  onOpen,
}: {
  audit: AuditIndexEntry;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-border/60 hover:bg-foreground/[0.03] focus-visible:ring-ring flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none focus-visible:ring-2"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{day(audit.at)}</span>
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {audit.sessions} sessions · {tokens(audit.tokensRead)} tokens ·{" "}
            {audit.findings} findings
          </span>
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {audit.headline || audit.top[0] || "No findings"}
        </p>
      </div>
      <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
    </button>
  );
}

function AuditReport({ id, onBack }: { id: string; onBack: () => void }) {
  const report = useAuditReportQuery(id);
  return (
    <div className="space-y-3">
      <Button
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
  const [open, setOpen] = useState<string | null>(null);

  if (open) return <AuditReport id={open} onBack={() => setOpen(null)} />;
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
    <div className="space-y-2">
      {audits.data.map((a) => (
        <AuditRow key={a.id} audit={a} onOpen={() => setOpen(a.id)} />
      ))}
    </div>
  );
}
