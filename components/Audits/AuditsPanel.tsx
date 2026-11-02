"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListSection } from "@/components/Settings/ListSection";
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

// The line under the title: when, then what it found.
function detail(a: AuditListItem): string {
  const parts = [day(a.at)];
  if (a.kind === "sessions")
    parts.push(
      `${a.sessions ?? 0} sessions`,
      `${tokens(a.tokensRead ?? 0)} tokens`
    );
  if (a.findings !== undefined) parts.push(`${a.findings} findings`);
  return parts.join(" · ");
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
      className="hover:bg-foreground/[0.03] focus-visible:ring-ring flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="line-clamp-2 text-sm font-medium break-words">
          {audit.title}
        </p>
        <p className="text-muted-foreground text-xs">{detail(audit)}</p>
        {audit.headline && (
          <p className="text-muted-foreground line-clamp-2 text-xs break-words">
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
  const all = audits.data ?? [];
  // A "While you were away" digest is a different thing from an audit.
  const away = all.filter((a) => a.kind === "away");
  const real = all.filter((a) => a.kind !== "away");
  const key = (a: AuditListItem) => `${a.kind}/${a.id}`;
  const row = (a: AuditListItem) => (
    <AuditRow audit={a} onOpen={() => setOpen({ kind: a.kind, id: a.id })} />
  );
  return (
    <div ref={listRef} className="space-y-5">
      <ListSection
        title="Session audits"
        help="Where sessions spent tokens and repeated work."
        items={real}
        keyOf={key}
        render={row}
        empty="No audits yet. Run /session-audit in a session on this project to audit what your sessions spent and repeated."
      />
      {away.length > 0 && (
        <ListSection
          title="While you were away"
          items={away}
          keyOf={key}
          render={row}
          empty=""
        />
      )}
    </div>
  );
}
