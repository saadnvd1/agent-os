"use client";

import {
  AppWindow,
  FileCode2,
  FileText,
  GitPullRequest,
  Image as ImageIcon,
  ListChecks,
  Play,
  ScrollText,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/share/view";
import { relativeTime } from "@/lib/schedules/when";
import type {
  ArtifactKind,
  SessionArtifact,
} from "@/lib/session-artifacts/types";
import { folderOf, isGone, stateLabel } from "./helpers";

const ICONS: Record<ArtifactKind, LucideIcon> = {
  plan: ListChecks,
  pr: GitPullRequest,
  run: Play,
  "session-log": ScrollText,
  page: AppWindow,
  file: FileText,
  image: ImageIcon,
  log: SquareTerminal,
};

export function ArtifactIcon({ artifact }: { artifact: SessionArtifact }) {
  const Icon =
    artifact.kind === "file" && artifact.preview === "html"
      ? FileCode2
      : ICONS[artifact.kind];
  const lead =
    artifact.kind === "plan" ||
    artifact.kind === "pr" ||
    artifact.kind === "run";
  return (
    <span
      className={cn(
        "bg-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
        lead ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

const MONO: ArtifactKind[] = ["file", "image"];

// The line under the name: where it is, or what it is.
function subline(a: SessionArtifact, mobile: boolean): string {
  const bits: string[] = [];
  if (a.by === "you") bits.push("attached by you");
  if (a.detail) bits.push(a.detail);
  if (mobile && a.edits)
    bits.push(`${a.edits} edit${a.edits === 1 ? "" : "s"}`);
  if (!bits.length && a.folder !== undefined) return a.folder;
  if (!bits.length && a.path) return folderOf(a.path);
  if (a.by === "shell") bits.push("made by a command");
  return bits.join(" · ");
}

export function ArtifactRow({
  artifact,
  pr,
  selected,
  mobile,
  onSelect,
}: {
  artifact: SessionArtifact;
  pr: string | null;
  selected: boolean;
  mobile: boolean;
  onSelect: () => void;
}) {
  const label = stateLabel(artifact, pr);
  const size = artifact.size !== undefined ? formatBytes(artifact.size) : null;
  const when = artifact.at ? relativeTime(artifact.at) : null;
  return (
    <button
      type="button"
      data-artifact-id={artifact.id}
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        "hover:bg-accent/60 flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors",
        mobile ? "min-h-14" : "min-h-12",
        selected && "bg-accent shadow-[inset_2px_0_0_hsl(var(--primary))]",
        isGone(artifact) && "opacity-55"
      )}
    >
      <ArtifactIcon artifact={artifact} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[13px]",
            MONO.includes(artifact.kind) && artifact.by !== "you" && "font-mono"
          )}
        >
          {artifact.name}
        </span>
        <span
          className={cn(
            "text-muted-foreground block truncate text-[11.5px]",
            !artifact.detail && artifact.path && "font-mono"
          )}
        >
          {subline(artifact, mobile)}
        </span>
      </span>
      <span className="text-muted-foreground shrink-0 text-right text-[11.5px] whitespace-nowrap">
        {!mobile && (artifact.edits || label) && (
          <span className="block">
            {artifact.edits
              ? `${artifact.edits} edit${artifact.edits === 1 ? "" : "s"}`
              : null}
            {label && (
              <span
                className={cn(
                  "ml-1 rounded border px-1 text-[10.5px]",
                  artifact.state === "kept" &&
                    "border-emerald-500/35 text-emerald-600 dark:text-emerald-400",
                  artifact.state === "in-pr" && "border-primary/35 text-primary"
                )}
              >
                {label}
              </span>
            )}
          </span>
        )}
        <span className="block">
          {mobile && label ? `${label} · ` : ""}
          {[size, when].filter(Boolean).join(" · ")}
          {mobile && " ›"}
        </span>
      </span>
    </button>
  );
}
