"use client";

import { useState } from "react";
import {
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Chat/Markdown";
import { ArtifactFrame } from "@/components/Chat/ArtifactFrame";
import { artifactContentUrl, useArtifactText } from "@/data/session-artifacts";
import { formatBytes } from "@/lib/share/view";
import { relativeTime } from "@/lib/schedules/when";
import { openable, type SessionArtifact } from "@/lib/session-artifacts/types";
import { cn } from "@/lib/utils";
import { ArtifactIcon } from "./ArtifactRow";
import { stateLabel } from "./helpers";

function Body({
  sessionId,
  artifact,
  pr,
}: {
  sessionId: string;
  artifact: SessionArtifact;
  pr: string | null;
}) {
  const url = artifactContentUrl(sessionId, artifact.id);
  const textual =
    openable(artifact) &&
    (artifact.preview === "markdown" || artifact.preview === "text");
  const text = useArtifactText(textual ? url : null);

  if (!openable(artifact))
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {artifact.state === "in-pr"
          ? `Committed, and its worktree was removed: it's in ${pr ? `PR #${pr}` : "the PR"}.`
          : artifact.state === "outside"
            ? "Outside the folders AgentOS serves, so it isn't opened here."
            : artifact.state === "gone"
              ? "Gone: its worktree was removed and no copy was kept."
              : "Nothing to preview."}
      </p>
    );

  if (artifact.preview === "html")
    return (
      <ArtifactFrame
        artifactId={artifact.id}
        src={url}
        title={artifact.name}
        fill
        className="bg-background"
      />
    );

  if (artifact.preview === "image")
    return (
      <div className="flex min-h-full items-start justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={artifact.name}
          className="max-w-full rounded-lg border"
        />
      </div>
    );

  if (text.isPending)
    return <div className="bg-muted/40 m-4 h-40 animate-pulse rounded-lg" />;
  if (text.isError)
    return <p className="text-destructive p-4 text-sm">{text.error.message}</p>;
  const note = text.data.truncated && (
    <p className="text-muted-foreground mb-3 text-xs">
      {artifact.kind === "log"
        ? "Showing the end of the output."
        : "Showing the start of the file."}
    </p>
  );
  if (artifact.preview === "markdown")
    return (
      <div className="mx-auto max-w-3xl px-5 py-5">
        {note}
        <Markdown text={text.data.text} />
      </div>
    );
  return (
    <div className="p-4">
      {note}
      <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        {text.data.text}
      </pre>
    </div>
  );
}

export function ArtifactPreview({
  sessionId,
  artifact,
  pr,
  mobile,
  onBack,
  onOpenInFiles,
}: {
  sessionId: string;
  artifact: SessionArtifact;
  pr: string | null;
  mobile: boolean;
  onBack?: () => void;
  onOpenInFiles?: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const label = stateLabel(artifact, pr);
  // Inside the worktree, the path from its top; the full one is copied.
  const where =
    artifact.path && artifact.folder !== undefined
      ? [artifact.folder, artifact.path.split("/").pop()]
          .filter(Boolean)
          .join("/")
      : artifact.path;
  const meta = [
    where,
    label,
    artifact.size !== undefined ? formatBytes(artifact.size) : null,
    mobile && artifact.at ? relativeTime(artifact.at) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const copy = () => {
    if (!artifact.path) return;
    void navigator.clipboard?.writeText(artifact.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const canOpenInFiles =
    !!onOpenInFiles &&
    !!artifact.path &&
    artifact.state === "live" &&
    (artifact.kind === "file" || artifact.kind === "plan");
  const actions = (
    <>
      {artifact.url && (
        <Button
          variant="outline"
          size="sm"
          asChild
          className={cn(mobile && "h-11 flex-1")}
        >
          <a
            href={artifact.url}
            target="_blank"
            rel="noreferrer"
            title="Open PR"
          >
            <ExternalLink className="h-3.5 w-3.5" />{" "}
            <span className={cn(!mobile && "hidden @lg:inline")}>Open PR</span>
          </a>
        </Button>
      )}
      {artifact.path && (
        <Button
          variant="outline"
          size="sm"
          onClick={copy}
          title="Copy path"
          className={cn(mobile && "h-11 flex-1")}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span className={cn(!mobile && "hidden @lg:inline")}>Copy path</span>
        </Button>
      )}
      {canOpenInFiles && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenInFiles(artifact.path!)}
          title="Open in Files"
          className={cn(mobile && "h-11 flex-1")}
        >
          <FolderOpen className="h-3.5 w-3.5" />{" "}
          <span className={cn(!mobile && "hidden @lg:inline")}>
            Open in Files
          </span>
        </Button>
      )}
    </>
  );
  const hasActions = !!(artifact.url || artifact.path);

  return (
    <div className="@container flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2.5 border-b px-3 py-2.5 sm:px-4">
        {mobile ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to artifacts"
            onClick={onBack}
            className="-ml-1 h-11 w-11 shrink-0"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        ) : (
          <ArtifactIcon artifact={artifact} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">
            {artifact.name}
          </div>
          {meta && (
            <div className="text-muted-foreground truncate font-mono text-[11px]">
              {meta}
            </div>
          )}
        </div>
        {!mobile && hasActions && (
          <div className="flex shrink-0 gap-1.5">{actions}</div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Body sessionId={sessionId} artifact={artifact} pr={pr} />
      </div>
      {mobile && hasActions && (
        <div className="flex gap-2 border-t px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {actions}
        </div>
      )}
    </div>
  );
}
