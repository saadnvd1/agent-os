"use client";

import { useState } from "react";
import {
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  FolderOpen,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Chat/Markdown";
import { ArtifactFrame } from "@/components/Chat/ArtifactFrame";
import {
  artifactContentUrl,
  useArtifactText,
  useArtifactVersions,
} from "@/data/session-artifacts";
import { artifactActions, type ArtifactAction } from "@/lib/artifacts/actions";
import { formatBytes } from "@/lib/share/view";
import { relativeTime } from "@/lib/schedules/when";
import { openable, type SessionArtifact } from "@/lib/session-artifacts/types";
import { cn } from "@/lib/utils";
import { ArtifactIcon } from "./ArtifactRow";
import { stateLabel } from "./helpers";
import { ArtifactActions } from "./ArtifactActions";
import { ArtifactFullscreen } from "./ArtifactFullscreen";
import { ArtifactCompare } from "./Compare";
import { VersionSwitcher } from "./VersionSwitcher";

function Body({
  sessionId,
  artifact,
  pr,
  versionId,
}: {
  sessionId: string;
  artifact: SessionArtifact;
  pr: string | null;
  // A page's version to show, served by its own id.
  versionId?: string;
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
        artifactId={versionId ?? artifact.id}
        src={versionId ? undefined : url}
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
  remote = false,
  onBack,
  onOpenInFiles,
}: {
  sessionId: string;
  artifact: SessionArtifact;
  pr: string | null;
  mobile: boolean;
  // On a linked machine: its pages are read through the session, one
  // version only.
  remote?: boolean;
  onBack?: () => void;
  onOpenInFiles?: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const [comparing, setComparing] = useState(false);
  // The version picked; none means the latest, which follows new versions.
  const [picked, setPicked] = useState<string | null>(null);
  const page =
    artifact.kind === "page" && !!artifact.artifactId && !remote
      ? artifact.artifactId
      : null;
  // Keyed by the latest version, so a new one refetches.
  const versionsQuery = useArtifactVersions(
    page ?? "",
    page ?? "",
    !!page && openable(artifact)
  );
  const versions = versionsQuery.data?.versions ?? [];
  const shownId =
    (picked && versions.some((v) => v.id === picked) && picked) || page;
  const shown = versions.find((v) => v.id === shownId);
  const latest = versions[versions.length - 1];
  const many = versions.length > 1;
  const older = many && !!shown && shown.id !== latest?.id;

  const showCompare = comparing && many;
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
    many && shown && `v${shown.version} of ${versions.length}`,
    shown?.turn && `turn ${shown.turn.index}`,
    !shown && artifact.size !== undefined ? formatBytes(artifact.size) : null,
    shown?.bytes !== undefined ? formatBytes(shown.bytes) : null,
    (mobile || shown) &&
      (shown?.createdAt || artifact.at) &&
      relativeTime(shown?.createdAt || artifact.at),
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
  const list = artifact.actions ?? artifactActions(artifact, { pdf: false });
  const can = (id: ArtifactAction["id"]) => list.some((a) => a.id === id);
  // A linked machine's page is read through the session: only full screen.
  const pageList = page
    ? (versionsQuery.data?.actions ?? list)
    : list.filter((a) => a.id === "fullscreen");
  const canOpenInFiles = !!onOpenInFiles && can("open-in-files");
  const fileActions = (
    <>
      {artifact.url && can("open-pr") && (
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
      {artifact.path && can("copy-path") && (
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
      {canOpenInFiles && artifact.path && (
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
  const isPage = artifact.kind === "page" && openable(artifact);
  const pageActionsFor = (variant: "labelled" | "bar") => (
    <ArtifactActions
      artifactId={shownId ?? artifact.id}
      title={shown?.title ?? artifact.name}
      version={many ? shown?.version : undefined}
      actions={pageList}
      variant={variant}
      onFull={() => setFull(true)}
      onCompare={() => setComparing(true)}
    />
  );
  const actions = isPage
    ? pageActionsFor(mobile ? "bar" : "labelled")
    : fileActions;
  const hasActions = isPage
    ? pageList.length > 0
    : list.some((a) => a.id !== "open-in-files" || canOpenInFiles);
  const switcher = many && shownId && (
    <VersionSwitcher
      versions={versions}
      currentId={shownId}
      onPick={(id) => setPicked(id === latest?.id ? null : id)}
      mobile={mobile}
    />
  );

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
            {shown?.title ?? artifact.name}
          </div>
          {meta && (
            <div className="text-muted-foreground truncate font-mono text-[11px]">
              {meta}
            </div>
          )}
        </div>
        {!mobile && switcher && (
          <div className="hidden @3xl:flex">{switcher}</div>
        )}
        {!mobile && hasActions && (
          <div className="flex shrink-0 gap-1.5">{actions}</div>
        )}
      </div>
      {mobile && switcher && !showCompare && (
        <div className="bg-card border-b px-1">{switcher}</div>
      )}
      {!mobile && switcher && !showCompare && (
        <div className="flex border-b px-3 py-1.5 sm:px-4 @3xl:hidden">
          {switcher}
        </div>
      )}
      {older && latest && !showCompare && (
        <div className="flex min-h-11 items-center gap-2 border-b border-amber-500/25 bg-amber-500/[0.08] px-3 text-[12.5px] sm:px-4">
          <History className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1 truncate">
            Older version
            <span className="hidden @md:inline">
              . The agent changed this page since.
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 shrink-0 md:h-7"
            onClick={() => setPicked(null)}
          >
            Go to latest (v{latest.version})
          </Button>
        </div>
      )}
      {showCompare && shownId ? (
        <div className="min-h-0 flex-1">
          <ArtifactCompare
            sessionId={sessionId}
            versions={versions}
            shownId={shownId}
            onClose={() => setComparing(false)}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Body
            sessionId={sessionId}
            artifact={artifact}
            pr={pr}
            versionId={shownId ?? undefined}
          />
        </div>
      )}
      {mobile && hasActions && !showCompare && (
        <div className="flex gap-2 border-t px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {isPage ? <div className="flex-1">{actions}</div> : actions}
        </div>
      )}
      {isPage && (
        <ArtifactFullscreen
          open={full}
          onOpenChange={setFull}
          artifactId={shownId ?? artifact.id}
          src={shownId ? undefined : artifactContentUrl(sessionId, artifact.id)}
          title={shown?.title ?? artifact.name}
          actions={
            page ? (
              <ArtifactActions
                artifactId={shownId ?? artifact.id}
                title={shown?.title ?? artifact.name}
                version={many ? shown?.version : undefined}
                actions={pageList.filter((a) => a.id !== "fullscreen")}
                variant="icons"
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
