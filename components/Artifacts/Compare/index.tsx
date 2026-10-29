"use client";

import { useState } from "react";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { useArtifactCompare } from "@/data/session-artifacts";
import type { ArtifactVersion } from "@/lib/artifacts/actions";
import { summaryLabel } from "@/lib/artifacts/compare/diff";
import { relativeTime } from "@/lib/schedules/when";
import { DiffView } from "./DiffView";
import { SideBySide } from "./SideBySide";
import { VersionPicker } from "./VersionPicker";

type View = "changes" | "side" | "source";

// The shown version against the one before it; the first version against
// the one after.
export function defaultPair(
  versions: ArtifactVersion[],
  shownId: string
): { from: string; to: string } {
  const i = Math.max(
    0,
    versions.findIndex((v) => v.id === shownId)
  );
  return i > 0
    ? { from: versions[i - 1].id, to: versions[i].id }
    : {
        from: versions[0].id,
        to: versions[Math.min(1, versions.length - 1)].id,
      };
}

function Note({ v, label }: { v: ArtifactVersion; label: string }) {
  return (
    <div className="bg-muted/50 min-w-0 rounded-lg px-3 py-2 text-[12.5px]">
      <div className="text-muted-foreground text-[11px]">
        {label} · v{v.version} · {relativeTime(v.createdAt)}
      </div>
      <div className="break-words">
        {v.note || (
          <span className="text-muted-foreground">No note on this version</span>
        )}
      </div>
    </div>
  );
}

function Changes({
  sessionId,
  from,
  to,
  mode,
  onSide,
}: {
  sessionId: string;
  from: ArtifactVersion;
  to: ArtifactVersion;
  mode: "changes" | "source";
  onSide: () => void;
}) {
  const q = useArtifactCompare(sessionId, from.id, to.id, mode);
  if (q.isPending)
    return <div className="bg-muted/40 m-3 h-40 animate-pulse rounded-lg" />;
  if (q.isError)
    return <p className="text-destructive p-4 text-sm">{q.error.message}</p>;
  const d = q.data;
  if ("tooLarge" in d)
    return (
      <div className="p-3">
        <Notice
          tone="warning"
          action={
            <Button variant="outline" className="h-11 md:h-8" onClick={onSide}>
              Side by side
            </Button>
          }
        >
          These pages are {d.reason}. Compare them side by side instead.
        </Notice>
      </div>
    );
  const same = d.summary.added + d.summary.removed === 0;
  return (
    <div>
      <div className="px-4 pt-3 text-[13px] font-medium">
        {summaryLabel(d.summary)}
        <span className="text-muted-foreground font-normal">
          {mode === "changes" ? " · visible text" : " · HTML source"}
        </span>
      </div>
      {same ? (
        <p className="text-muted-foreground p-4 text-sm">
          {mode === "changes"
            ? "The visible text is the same. Look at Side by side or Source for styling and script changes."
            : "The source is identical."}
        </p>
      ) : (
        <DiffView lines={d.lines} wrap={mode === "changes"} />
      )}
    </div>
  );
}

// Two versions of a page: what changed in its text, side by side, or in its
// HTML. Owner's viewer only; never offered on a share or public link.
export function ArtifactCompare({
  sessionId,
  versions,
  shownId,
  onClose,
}: {
  sessionId: string;
  versions: ArtifactVersion[];
  shownId: string;
  onClose: () => void;
}) {
  const [pair, setPair] = useState(() => defaultPair(versions, shownId));
  const [view, setView] = useState<View>("changes");
  const from = versions.find((v) => v.id === pair.from) ?? versions[0];
  const to =
    versions.find((v) => v.id === pair.to) ?? versions[versions.length - 1];
  const [a, b] = from.version <= to.version ? [from, to] : [to, from];

  return (
    <div className="@container flex h-full min-w-0 flex-col">
      <div className="flex flex-col gap-3 border-b px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to the page"
            onClick={onClose}
            className="-ml-1 h-11 w-11 shrink-0 md:h-8 md:w-8"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="text-[13px] font-medium">Compare versions</div>
        </div>
        <div className="flex items-end gap-2">
          <VersionPicker
            name="From"
            value={from.id}
            versions={versions}
            onChange={(id) => setPair({ ...pair, from: id })}
          />
          <ArrowRight className="text-muted-foreground mb-3.5 h-4 w-4 shrink-0 md:mb-2.5" />
          <VersionPicker
            name="To"
            value={to.id}
            versions={versions}
            onChange={(id) => setPair({ ...pair, to: id })}
          />
        </div>
        <div className="grid gap-2 @xl:grid-cols-2">
          <Note v={a} label="Before" />
          <Note v={b} label="After" />
        </div>
        <Segmented
          label="Comparison"
          value={view}
          onChange={setView}
          options={[
            { value: "changes", label: "Changes" },
            { value: "side", label: "Side by side" },
            { value: "source", label: "Source" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {from.id === to.id ? (
          <p className="text-muted-foreground p-4 text-sm">
            Pick two different versions.
          </p>
        ) : view === "side" ? (
          <SideBySide from={a} to={b} />
        ) : (
          <Changes
            sessionId={sessionId}
            from={a}
            to={b}
            mode={view === "source" ? "source" : "changes"}
            onSide={() => setView("side")}
          />
        )}
      </div>
    </div>
  );
}
