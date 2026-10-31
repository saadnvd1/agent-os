"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Lightbulb, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMarkTipSeen, useSetTipsOff, useTips } from "@/data/tips";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { TipMedia } from "./TipMedia";

export function TipDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  const { data } = useTips();
  const markSeen = useMarkTipSeen();
  const setOff = useSetTipsOff();
  const deck = data?.deck ?? [];
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      deck.findIndex((t) => t.id === data?.today?.id)
    )
  );
  const tip = deck[index];

  // Whatever tip is on screen counts as seen; today's one clears the dot.
  const tipId = tip?.id;
  useEffect(() => {
    if (tipId) markSeen.mutate(tipId);
    // markSeen is a new object each render; the tip is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipId]);

  const step = (by: number) =>
    setIndex((i) => (i + by + deck.length) % deck.length);

  const turnOff = () => {
    setOff.mutate(true, {
      onSuccess: () =>
        toast("Tips are off. Turn them back on in Settings → Updates.", {
          action: { label: "Undo", onClick: () => setOff.mutate(false) },
        }),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        placement={wide ? "center" : "sheet"}
        className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[26rem] md:max-w-[36rem]"
      >
        <div className="bg-muted-foreground/40 mx-auto mt-2 h-1 w-9 rounded-full md:hidden" />
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <span className="bg-muted grid size-7 shrink-0 place-items-center rounded-lg">
            <Lightbulb className="size-4" />
          </span>
          <DialogDescription className="label-mono text-muted-foreground min-w-0 flex-1 text-xs">
            Tip of the Day
            {deck.length > 1 && ` · ${index + 1} of ${deck.length}`}
          </DialogDescription>
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
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-2 pb-4">
          {tip ? (
            <>
              {tip.media && <TipMedia key={tip.id} media={tip.media} />}
              <DialogTitle className="text-base font-semibold">
                {tip.title}
              </DialogTitle>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {tip.body}
              </p>
              {tip.url && (
                <a
                  href={tip.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary w-fit text-sm underline"
                >
                  Learn more
                </a>
              )}
            </>
          ) : (
            <DialogTitle className="text-sm font-medium">
              No tips right now.
            </DialogTitle>
          )}
        </div>
        <div className="bg-muted/40 flex items-center gap-2 px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-11 px-2 md:h-8"
            onClick={turnOff}
          >
            Don&apos;t show tips
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous tip"
              disabled={deck.length < 2}
              onClick={() => step(-1)}
              className="size-11 md:size-8"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next tip"
              disabled={deck.length < 2}
              onClick={() => step(1)}
              className="size-11 md:size-8"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
