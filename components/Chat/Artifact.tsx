"use client";

import { useState } from "react";
import { ExternalLink, Maximize2, X } from "lucide-react";
import type { ChatItem } from "@/lib/chat/events";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ArtifactFrame, artifactUrl } from "./ArtifactFrame";

type ArtifactItem = Extract<ChatItem, { kind: "artifact" }>;

const ICON_BUTTON =
  "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] inline-flex h-11 w-11 items-center justify-center rounded-lg md:h-8 md:w-8";

function Actions({
  item,
  onFull,
}: {
  item: ArtifactItem;
  onFull?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      {onFull && (
        <button
          type="button"
          onClick={onFull}
          className={ICON_BUTTON}
          aria-label="Full screen"
          title="Full screen"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
      <a
        href={artifactUrl(item.artifactId)}
        target="_blank"
        rel="noopener noreferrer"
        className={ICON_BUTTON}
        aria-label="Open in new tab"
        title="Open in new tab"
      >
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}

// A page the agent showed with html_render, live, in its own card.
export function ArtifactCard({ item }: { item: ArtifactItem }) {
  const [full, setFull] = useState(false);
  return (
    <div className="bg-foreground/[0.03] overflow-hidden rounded-xl shadow-sm">
      <div className="flex items-center gap-2 py-0.5 pr-1 pl-3.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.title}
        </span>
        <Actions item={item} onFull={() => setFull(true)} />
      </div>
      <ArtifactFrame
        artifactId={item.artifactId}
        title={item.title}
        maxHeight={item.height}
      />
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:max-w-none"
        >
          <div className="flex items-center gap-2 py-1 pt-[max(0.25rem,env(safe-area-inset-top))] pr-1 pl-4">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
              {item.title}
            </DialogTitle>
            <Actions item={item} />
            <button
              type="button"
              onClick={() => setFull(false)}
              className={ICON_BUTTON}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
            {full && (
              <ArtifactFrame
                artifactId={item.artifactId}
                title={item.title}
                fill
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
