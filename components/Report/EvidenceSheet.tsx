"use client";

import { ExternalLink } from "lucide-react";
import {
  ASheet,
  ASheetContent,
  ASheetDescription,
  ASheetHeader,
  ASheetTitle,
} from "@/components/a/ASheet";
import { StatusPill } from "@/components/ui/status-pill";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { EvidenceRef } from "@/lib/reports/types";

const TONE = {
  pass: "green",
  fail: "red",
  pending: "amber",
  info: "muted",
} as const;
const WORD = {
  pass: "Passed",
  fail: "Failed",
  pending: "Waiting",
  info: "Info",
} as const;

// What a report line rests on. The text is untrusted output: shown, never run.
export function EvidenceSheet({
  evidence,
  stale,
  onClose,
}: {
  evidence: EvidenceRef | null;
  stale: boolean;
  onClose: () => void;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  return (
    <ASheet open={!!evidence} onOpenChange={(o) => !o && onClose()}>
      <ASheetContent
        side={wide ? "right" : "bottom"}
        className={wide ? "w-full max-w-md" : "max-h-[80dvh] rounded-t-2xl"}
      >
        {evidence && (
          <>
            <ASheetHeader className="pr-12">
              <ASheetTitle className="break-words">
                {evidence.label}
              </ASheetTitle>
              <ASheetDescription className="flex flex-wrap items-center gap-2">
                <StatusPill tone={TONE[evidence.status]}>
                  {WORD[evidence.status]}
                </StatusPill>
                <span>{evidence.kind}</span>
                {evidence.sha && (
                  <span className="font-mono">{evidence.sha.slice(0, 7)}</span>
                )}
                {stale && evidence.sha && <span>older push</span>}
              </ASheetDescription>
            </ASheetHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-6">
              {evidence.excerpt ? (
                <pre className="bg-muted/60 max-h-[50dvh] overflow-auto rounded-lg p-3 text-xs break-words whitespace-pre-wrap">
                  {evidence.excerpt}
                </pre>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No output was kept for this one.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {evidence.url && (
                  <a
                    href={evidence.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-secondary inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm"
                  >
                    Open in CI <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {evidence.href && (
                  <a
                    href={evidence.href}
                    className="bg-secondary inline-flex min-h-11 items-center rounded-lg px-3 text-sm"
                  >
                    Show in the task
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </ASheetContent>
    </ASheet>
  );
}
