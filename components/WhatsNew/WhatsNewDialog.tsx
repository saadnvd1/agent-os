"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShimmeringLoader } from "@/components/ui/skeleton";
import {
  useWhatsNewAhead,
  useWhatsNewHead,
  useWhatsNewList,
} from "@/data/whats-new";
import { useUpdates } from "@/data/updates";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { whatsNewStore } from "@/stores/whatsNew";
import { useWhatsNewSeen } from "@/hooks/useWhatsNewSeen";
import { buildRows, type Row } from "@/lib/whats-new/rows";
import { unreadCount } from "@/lib/whats-new/unread";
import { WhatsNewRow } from "./WhatsNewRows";

function Empty() {
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 px-8 py-12 text-center">
      <span className="bg-muted grid size-11 place-items-center rounded-xl">
        <Sparkles className="size-5" />
      </span>
      <h3 className="text-foreground text-[15px] font-semibold">
        Nothing to show yet
      </h3>
      <p className="max-w-[17.5rem] text-[13px]">
        Changes appear here after your next update.
      </p>
    </div>
  );
}

export function WhatsNewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  const { data: head } = useWhatsNewHead();
  const { seen, markSeen } = useWhatsNewSeen(head);
  const { data: updates } = useUpdates();
  const waiting = !!updates?.available;
  const list = useWhatsNewList(open);
  const ahead = useWhatsNewAhead(open && waiting);
  const [previewing, setPreviewing] = useState(whatsNewStore.preview);
  // Where the last visit ended, read once as the dialog opens: opening marks
  // everything seen, and the divider has to stay where it was.
  const [baseline] = useState(seen);
  useEffect(() => {
    markSeen();
    // Once, on open; `seen` changes as a result of this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entries = useMemo(
    () => list.data?.pages.flatMap((p) => p.entries) ?? [],
    [list.data]
  );
  const rows = useMemo<Row[]>(() => {
    const own = buildRows(entries, baseline);
    const coming = previewing && ahead.data?.length ? ahead.data : [];
    return coming.length
      ? [
          { type: "heading", key: "ahead", label: "Arrives with the update" },
          ...buildRows(coming, null),
          { type: "heading", key: "installed", label: "Already installed" },
          ...own,
        ]
      : own;
  }, [entries, baseline, previewing, ahead.data]);

  const unread =
    head && baseline !== null ? unreadCount(head.recent, baseline) : 0;
  const version = updates?.current?.version;
  const aheadCount = ahead.data?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        placement={wide ? "center" : "sheet"}
        className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 max-md:h-[85dvh] sm:max-w-[34rem]"
      >
        <div className="bg-muted-foreground/40 mx-auto mt-2 h-1 w-9 rounded-full md:hidden" />
        <div className="border-border/50 flex items-center gap-2 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle>What&apos;s New</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              {[
                version && `AgentOS ${version}`,
                unread > 0
                  ? `${unread} new since you last looked`
                  : "You're up to date",
              ]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              className="-mr-2 size-11 shrink-0 md:size-8"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {waiting && aheadCount > 0 && (
            <div className="bg-primary/10 mx-3 mt-3 flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px]">
              <span className="flex-1">
                <b className="font-semibold">Update available.</b> {aheadCount}{" "}
                more {aheadCount === 1 ? "change is" : "changes are"} waiting.
              </span>
              <button
                type="button"
                aria-pressed={previewing}
                onClick={() => setPreviewing(!previewing)}
                className="text-primary -my-1 min-h-11 px-2 font-semibold md:min-h-8"
              >
                {previewing ? "Hide" : "Preview"}
              </button>
            </div>
          )}
          {list.isPending ? (
            <div className="space-y-3 p-4" aria-busy>
              {[0, 1, 2, 3].map((i) => (
                <ShimmeringLoader
                  key={i}
                  delayIndex={i}
                  className="h-9 w-full"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <Empty />
          ) : (
            rows.map((row) => <WhatsNewRow key={row.key} row={row} />)
          )}
          {list.hasNextPage && (
            <Button
              variant="secondary"
              className="mx-4 my-2 min-h-11 w-[calc(100%-2rem)]"
              disabled={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage()}
            >
              Show older changes
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
