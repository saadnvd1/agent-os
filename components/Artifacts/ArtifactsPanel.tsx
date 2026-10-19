"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  artifactContentUrl,
  useSessionArtifacts,
} from "@/data/session-artifacts";
import { openable, type SessionArtifact } from "@/lib/session-artifacts/types";
import { ArtifactPreview } from "./ArtifactPreview";
import { ArtifactRow } from "./ArtifactRow";
import {
  counts,
  FILTER_LABELS,
  groups,
  prNumber,
  step,
  visible,
  type ArtifactFilter,
} from "./helpers";

// Images that can be shown, as tiles; the rest are rows like any file.
function ImageTiles({
  sessionId,
  images,
  selected,
  onSelect,
}: {
  sessionId: string;
  images: SessionArtifact[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 px-3.5 pt-1 pb-2.5">
      {images.map((a) => (
        <button
          key={a.id}
          type="button"
          data-artifact-id={a.id}
          onClick={() => onSelect(a.id)}
          title={a.name}
          className={cn(
            "bg-muted relative aspect-[4/3] overflow-hidden rounded-lg border",
            selected === a.id && "ring-primary ring-2"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artifactContentUrl(sessionId, a.id)}
            alt={a.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          <span className="bg-background/80 text-muted-foreground absolute right-0 bottom-0 left-0 truncate px-1.5 py-0.5 text-left text-[10px]">
            {a.by === "you" ? "by you" : a.name}
          </span>
        </button>
      ))}
    </div>
  );
}

export function ArtifactsPanel({
  sessionId,
  mobile,
  onOpenInFiles,
}: {
  sessionId: string;
  mobile: boolean;
  onOpenInFiles?: (path: string) => void;
}) {
  const { data, isPending, isError, error } = useSessionArtifacts(sessionId);
  const [filter, setFilter] = useState<ArtifactFilter>("all");
  const [showGone, setShowGone] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => data?.artifacts ?? [], [data]);
  const list = useMemo(
    () => visible(all, filter, showGone),
    [all, filter, showGone]
  );
  const tally = useMemo(() => counts(all, showGone), [all, showGone]);
  const pr = prNumber(all);
  const goneCount = all.length - visible(all, "all", false).length;
  // On a wide pane the first row is open until another is picked.
  const selected =
    all.find((a) => a.id === selectedId) ?? (mobile ? null : (list[0] ?? null));
  const selectedKey = selected?.id ?? null;

  useEffect(() => {
    if (!selectedKey) return;
    listRef.current
      ?.querySelector(`[data-artifact-id="${selectedKey}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setSelectedId(step(list, selectedKey, e.key === "ArrowDown" ? 1 : -1));
  };

  if (isPending)
    return <div className="bg-muted/40 m-4 h-40 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive p-4 text-sm">{error.message}</p>;

  if (mobile && selected)
    return (
      <ArtifactPreview
        sessionId={sessionId}
        artifact={selected}
        pr={pr}
        mobile
        onBack={() => setSelectedId(null)}
        onOpenInFiles={onOpenInFiles}
      />
    );

  const header = (
    <div className="bg-background sticky top-0 z-10 px-3.5 pt-3 pb-2">
      <div className="flex items-baseline gap-1.5 text-[13.5px] font-semibold">
        Artifacts
        <span className="text-muted-foreground font-normal">{tally.all}</span>
        {goneCount > 0 && (
          <button
            type="button"
            onClick={() => setShowGone(!showGone)}
            className="text-muted-foreground hover:text-foreground ml-auto py-1 text-xs font-normal"
          >
            {showGone ? "Hide gone" : `Show gone (${goneCount})`}
          </button>
        )}
      </div>
      <div className="mt-2.5 flex scrollbar-none gap-1.5 overflow-x-auto">
        {(Object.keys(FILTER_LABELS) as ArtifactFilter[])
          .filter((f) => f === "all" || tally[f])
          .map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap",
                mobile && "min-h-9 px-3",
                filter === f
                  ? "bg-foreground text-background border-transparent"
                  : "text-muted-foreground"
              )}
            >
              {FILTER_LABELS[f]}
              {f !== "all" && ` ${tally[f]}`}
            </button>
          ))}
      </div>
    </div>
  );

  const empty = (
    <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 py-12 text-center text-sm">
      <Package className="h-5 w-5" />
      {data.unreachable
        ? `This session runs on ${data.host}, which isn't reachable right now.`
        : all.length
          ? "Nothing here with these filters."
          : "Nothing yet. Files this session writes, pages it renders, images, job logs and its PR show up here."}
    </div>
  );

  const rows = (
    <div
      ref={listRef}
      tabIndex={mobile ? undefined : 0}
      onKeyDown={mobile ? undefined : onKeyDown}
      className="h-full overflow-y-auto outline-none"
    >
      {header}
      {list.length === 0
        ? empty
        : groups(list).map((g) => {
            const tiles =
              g.label === "Images" ? g.items.filter((a) => openable(a)) : [];
            const rest = g.items.filter((a) => !tiles.includes(a));
            return (
              <section key={g.label}>
                <h3 className="text-muted-foreground px-3.5 pt-3 pb-1 text-[11px] font-medium tracking-wider uppercase">
                  {g.label}
                  {g.label === "Images" && ` · ${g.items.length}`}
                </h3>
                {tiles.length > 0 && (
                  <ImageTiles
                    sessionId={sessionId}
                    images={tiles}
                    selected={selectedKey}
                    onSelect={setSelectedId}
                  />
                )}
                {rest.map((a) => (
                  <ArtifactRow
                    key={a.id}
                    artifact={a}
                    pr={pr}
                    mobile={mobile}
                    selected={a.id === selectedKey}
                    onSelect={() => setSelectedId(a.id)}
                  />
                ))}
              </section>
            );
          })}
    </div>
  );

  if (mobile) return rows;
  return (
    <div className="flex h-full min-h-0">
      <div className="w-[340px] shrink-0 border-r">{rows}</div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <ArtifactPreview
            sessionId={sessionId}
            artifact={selected}
            pr={pr}
            mobile={false}
            onOpenInFiles={onOpenInFiles}
          />
        ) : (
          <p className="text-muted-foreground p-6 text-sm">
            Select an artifact to preview it.
          </p>
        )}
      </div>
    </div>
  );
}
