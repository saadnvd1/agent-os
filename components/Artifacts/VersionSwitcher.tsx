"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SHEET } from "@/components/Hosts/sheet";
import type { ArtifactVersion } from "@/lib/artifacts/actions";
import { formatBytes } from "@/lib/share/view";
import { relativeTime } from "@/lib/schedules/when";
import { cn } from "@/lib/utils";

// "turn 9 · "split by plan" · 31m ago · 16 KB"
export function versionDetail(v: ArtifactVersion, full = true): string {
  return [
    v.turn && `turn ${v.turn.index}`,
    full && v.turn?.prompt && `“${v.turn.prompt}”`,
    relativeTime(v.createdAt),
    full && v.bytes !== undefined && formatBytes(v.bytes),
  ]
    .filter(Boolean)
    .join(" · ");
}

const summary = (v: ArtifactVersion) =>
  v.note || (v.version === 1 ? "First version" : `Version ${v.version}`);

function Row({
  v,
  latest,
  current,
  full,
}: {
  v: ArtifactVersion;
  latest: boolean;
  current: boolean;
  full: boolean;
}) {
  return (
    <>
      <span
        className={cn(
          "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px]",
          latest
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        v{v.version}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">
          {summary(v)}
          {latest && <span className="text-muted-foreground"> · latest</span>}
        </span>
        <span className="text-muted-foreground block truncate text-[11.5px]">
          {versionDetail(v, full)}
        </span>
      </span>
      {current && <Check className="text-primary h-4 w-4 shrink-0" />}
    </>
  );
}

// ‹ v2 of 3 › with the list of versions: a menu on a wide screen, a sheet
// on a phone. Hidden for a page with one version.
export function VersionSwitcher({
  versions,
  currentId,
  onPick,
  mobile,
  className,
}: {
  versions: ArtifactVersion[];
  currentId: string;
  onPick: (id: string) => void;
  mobile: boolean;
  className?: string;
}) {
  const [sheet, setSheet] = useState(false);
  if (versions.length < 2) return null;
  const i = Math.max(
    0,
    versions.findIndex((v) => v.id === currentId)
  );
  const current = versions[i];
  const last = versions.length - 1;
  const ordered = [...versions].reverse();
  const step = (d: number) => {
    const next = versions[i + d];
    if (next) onPick(next.id);
  };
  const arrow = mobile ? "h-11 w-11" : "h-[30px] w-[30px]";
  const label = (
    <>
      {!mobile && <History className="h-3.5 w-3.5" />}
      <span>
        <b className="font-semibold">v{current.version}</b>
        <span className="text-muted-foreground"> of {versions.length}</span>
      </span>
      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
    </>
  );

  return (
    <div
      className={cn(
        "flex items-center",
        mobile ? "w-full" : "h-8 shrink-0 rounded-lg border",
        className
      )}
    >
      <button
        type="button"
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex items-center justify-center disabled:opacity-30",
          arrow
        )}
        onClick={() => step(-1)}
        disabled={i === 0}
        aria-label="Older version"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {mobile ? (
        <>
          <button
            type="button"
            className="flex h-11 flex-1 items-center justify-center gap-1 text-[13px]"
            onClick={() => setSheet(true)}
            aria-label="Versions"
          >
            {label}
          </button>
          <Dialog open={sheet} onOpenChange={setSheet}>
            <DialogContent className={cn(SHEET, "gap-1 p-2 pt-4")}>
              <DialogTitle className="px-3 pb-1 text-sm">Versions</DialogTitle>
              {ordered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={cn(
                    "hover:bg-accent flex min-h-14 items-start gap-2.5 rounded-lg px-3 py-2 text-left",
                    v.id === current.id && "bg-accent"
                  )}
                  onClick={() => {
                    onPick(v.id);
                    setSheet(false);
                  }}
                >
                  <Row
                    v={v}
                    latest={v.id === versions[last].id}
                    current={v.id === current.id}
                    full={false}
                  />
                </button>
              ))}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-full items-center gap-1 border-x px-2 text-[12.5px]"
              aria-label="Versions"
            >
              {label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[22rem] max-w-[90vw]">
            {ordered.map((v) => (
              <DropdownMenuItem
                key={v.id}
                className="items-start gap-2.5 py-2"
                onSelect={() => onPick(v.id)}
              >
                <Row
                  v={v}
                  latest={v.id === versions[last].id}
                  current={v.id === current.id}
                  full
                />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        type="button"
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex items-center justify-center disabled:opacity-30",
          arrow
        )}
        onClick={() => step(1)}
        disabled={i === last}
        aria-label="Newer version"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
