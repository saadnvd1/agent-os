"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import type { ChatItem } from "@/lib/chat/events";
import { pageActions } from "@/lib/artifacts/actions";
import { useArtifactVersions } from "@/data/session-artifacts";
import { useViewport } from "@/hooks/useViewport";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArtifactActions } from "@/components/Artifacts/ArtifactActions";
import { ArtifactFullscreen } from "@/components/Artifacts/ArtifactFullscreen";
import { versionDetail } from "@/components/Artifacts/VersionSwitcher";
import { ArtifactFrame } from "./ArtifactFrame";

type ArtifactItem = Extract<ChatItem, { kind: "artifact" }>;

// Until the server answers: no PDF, which it may not be able to print.
const FALLBACK_ACTIONS = pageActions({ pdf: false });

// A page the agent showed with html_render, live, in its own card. It shows
// the version this turn made; a later one is a tap away.
export function ArtifactCard({ item }: { item: ArtifactItem }) {
  const [full, setFull] = useState(false);
  const [shownId, setShownId] = useState(item.artifactId);
  const { isMobile } = useViewport();
  const pageId = item.pageId ?? item.artifactId;
  const { data, refetch } = useArtifactVersions(pageId, item.artifactId);
  // A newer card for the same page: what's cached predates it.
  const stale = !!data && !data.versions.some((v) => v.id === item.artifactId);
  useEffect(() => {
    if (stale) void refetch();
  }, [stale, refetch]);

  const versions = data?.versions ?? [];
  const shown = versions.find((v) => v.id === shownId);
  const latest = versions[versions.length - 1];
  const many = versions.length > 1;
  const title = shown?.title ?? item.title;
  const actions = (
    <ArtifactActions
      artifactId={shownId}
      title={title}
      version={many ? shown?.version : undefined}
      actions={data?.actions ?? FALLBACK_ACTIONS}
      variant="icons"
      onFull={() => setFull(true)}
    />
  );

  return (
    <div className="bg-foreground/[0.03] overflow-hidden rounded-xl shadow-sm">
      <div className="flex items-center gap-2 py-0.5 pr-1 pl-3.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </span>
        {many && shown && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[11.5px]",
                  shown.id === latest.id
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
                aria-label="Versions"
              >
                {shown.id === latest.id
                  ? `v${shown.version} · latest`
                  : isMobile
                    ? `v${shown.version}/${versions.length}`
                    : `v${shown.version} of ${versions.length}`}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-w-[90vw]">
              {[...versions].reverse().map((v) => (
                <DropdownMenuItem
                  key={v.id}
                  className="min-h-11 flex-col items-start gap-0"
                  onSelect={() => setShownId(v.id)}
                >
                  <span className="text-[13px]">
                    v{v.version}
                    {v.note ? ` · ${v.note}` : ""}
                  </span>
                  <span className="text-muted-foreground text-[11.5px]">
                    {versionDetail(v, false)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {actions}
      </div>
      <ArtifactFrame
        artifactId={shownId}
        title={title}
        maxHeight={item.height}
      />
      {many && shown && latest && shown.id !== latest.id && (
        <button
          type="button"
          className="text-muted-foreground flex min-h-11 w-full items-center gap-1.5 border-t px-3.5 text-left text-[12.5px] md:min-h-9"
          onClick={() => setShownId(latest.id)}
        >
          <History className="h-3.5 w-3.5" />
          {latest.version - shown.version === 1
            ? "Updated since."
            : `Updated ${latest.version - shown.version} times since.`}
          <span className="text-primary">See v{latest.version}</span>
        </button>
      )}
      {many && shownId !== item.artifactId && shown?.id === latest?.id && (
        <button
          type="button"
          className="text-muted-foreground flex min-h-11 w-full items-center gap-1.5 border-t px-3.5 text-left text-[12.5px] md:min-h-9"
          onClick={() => setShownId(item.artifactId)}
        >
          <History className="h-3.5 w-3.5" />
          <span className="text-primary">
            Back to v{item.version ?? 1}, from this turn
          </span>
        </button>
      )}
      <ArtifactFullscreen
        open={full}
        onOpenChange={setFull}
        artifactId={shownId}
        title={title}
        actions={
          <ArtifactActions
            artifactId={shownId}
            title={title}
            version={many ? shown?.version : undefined}
            actions={(data?.actions ?? FALLBACK_ACTIONS).filter(
              (a) => a.id !== "fullscreen"
            )}
            variant="icons"
          />
        }
      />
    </div>
  );
}
