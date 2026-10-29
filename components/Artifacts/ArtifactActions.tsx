"use client";

import type { ReactNode } from "react";

import {
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { artifactUrl } from "@/components/Chat/ArtifactFrame";
import {
  DownloadMenu,
  useShareDownload,
} from "@/components/Share/DownloadMenu";
import type { PreviewRequest } from "@/data/shares";
import type { ArtifactAction, DownloadFormat } from "@/lib/artifacts/actions";
import { shareUiActions } from "@/stores/shareUi";
import { cn } from "@/lib/utils";

export const ICON_BUTTON =
  "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] inline-flex h-11 w-11 items-center justify-center rounded-lg md:h-8 md:w-8";

const FORMAT_LABEL: Record<DownloadFormat, string> = {
  pdf: "Download PDF",
  html: "Download HTML page",
  md: "Download Markdown",
};

interface Props {
  // The exact version every action acts on.
  artifactId: string;
  title: string;
  // Named in the share dialog when the page has more than one.
  version?: number;
  actions: ArtifactAction[];
  // icons: the chat card's title bar. labelled: the Artifacts view's header.
  // bar: the Artifacts view's bottom bar on a phone.
  variant: "icons" | "labelled" | "bar";
  onFull?: () => void;
}

// A rendered page's actions: full screen, share, open, download. One place
// for the chat card and the Artifacts view, from the server's list.
export function ArtifactActions({
  artifactId,
  title,
  version,
  actions,
  variant,
  onFull,
}: Props) {
  const has = (id: ArtifactAction["id"]) => actions.some((a) => a.id === id);
  const formats = actions.find((a) => a.id === "download")?.formats ?? [];
  const full = has("fullscreen") && onFull;
  const request: PreviewRequest = {
    kind: "artifact",
    artifactId,
    includeTools: false,
  };
  const href = artifactUrl(artifactId);
  const share = () =>
    shareUiActions.open({ kind: "artifact", artifactId, title, version });

  if (variant === "bar")
    return (
      <div className="flex gap-2">
        {has("share") && (
          <Button className="h-11 flex-1" onClick={share}>
            <Share2 className="h-4 w-4" /> Share
          </Button>
        )}
        {has("open") && (
          <Button variant="outline" className="h-11 flex-1" asChild>
            <a href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Open
            </a>
          </Button>
        )}
        {full && (
          <Button
            variant="outline"
            className="h-11 w-11 shrink-0"
            onClick={onFull}
            aria-label="Full screen"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        )}
        {formats.length > 0 && (
          <More request={request} title={title} formats={formats}>
            {(pending) => (
              <Button
                variant="outline"
                className="h-11 w-11 shrink-0"
                aria-label="More"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
              </Button>
            )}
          </More>
        )}
      </div>
    );

  if (variant === "labelled") {
    const label = "hidden @lg:inline";
    return (
      <div className="flex shrink-0 gap-1.5">
        {full && (
          <Button
            variant="outline"
            size="sm"
            onClick={onFull}
            title="Full screen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className={label}>Full screen</span>
          </Button>
        )}
        {has("share") && (
          <Button variant="outline" size="sm" onClick={share} title="Share">
            <Share2 className="h-3.5 w-3.5" />
            <span className={label}>Share</span>
          </Button>
        )}
        {has("open") && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className={label}>Open</span>
            </a>
          </Button>
        )}
        {formats.length > 0 && (
          <DownloadMenu
            formats={formats}
            request={request}
            title={title}
            disabled={false}
            trigger={(pending) => (
              <Button variant="outline" size="sm" title="Download">
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span className={label}>Download</span>
              </Button>
            )}
          />
        )}
      </div>
    );
  }

  // The card: every action as an icon from md up; on a phone, Share and a
  // More menu, so the title keeps its room.
  const wide = "hidden md:inline-flex";
  return (
    <div className="flex shrink-0 items-center">
      {full && (
        <button
          type="button"
          onClick={onFull}
          className={cn(ICON_BUTTON, wide)}
          aria-label="Full screen"
          title="Full screen"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
      {has("share") && (
        <button
          type="button"
          onClick={share}
          className={ICON_BUTTON}
          aria-label="Share"
          title="Share"
        >
          <Share2 className="h-4 w-4" />
        </button>
      )}
      {has("open") && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(ICON_BUTTON, wide)}
          aria-label="Open in new tab"
          title="Open in new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
      {formats.length > 0 && (
        <DownloadMenu
          formats={formats}
          request={request}
          title={title}
          disabled={false}
          trigger={(pending) => (
            <button
              type="button"
              className={cn(ICON_BUTTON, wide)}
              aria-label="Download"
              title="Download"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </button>
          )}
        />
      )}
      <More
        request={request}
        title={title}
        formats={formats}
        onFull={full ? onFull : undefined}
        href={has("open") ? href : undefined}
      >
        {(pending) => (
          <button
            type="button"
            className={cn(ICON_BUTTON, "md:hidden")}
            aria-label="More"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </button>
        )}
      </More>
    </div>
  );
}

// The phone's overflow menu: full screen and open when they didn't fit, then
// each download format.
function More({
  request,
  title,
  formats,
  onFull,
  href,
  children,
}: {
  request: PreviewRequest;
  title: string;
  formats: DownloadFormat[];
  onFull?: () => void;
  href?: string;
  children: (pending: boolean) => ReactNode;
}) {
  const { choose, pending } = useShareDownload(request, title);
  if (!onFull && !href && !formats.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children(pending)}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {onFull && (
          <DropdownMenuItem className="min-h-11 gap-2" onSelect={onFull}>
            <Maximize2 className="h-4 w-4" /> Full screen
          </DropdownMenuItem>
        )}
        {href && (
          <DropdownMenuItem className="min-h-11 gap-2" asChild>
            <a href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Open in new tab
            </a>
          </DropdownMenuItem>
        )}
        {formats.map((f) => (
          <DropdownMenuItem
            key={f}
            className="min-h-11 gap-2"
            onSelect={() => void choose(f)}
          >
            <Download className="h-4 w-4" /> {FORMAT_LABEL[f]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
