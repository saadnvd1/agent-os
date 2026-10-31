"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, useState, type TouchEvent } from "react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isCloseSwipe, type ViewerMedia } from "./viewer";

/** Full-screen image or clip over everything; closes on its own, never its parent dialog. */
export function MediaViewer({
  media,
  open,
  onOpenChange,
}: {
  media: ViewerMedia;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState(0);

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!start.current) return;
    setDrag(Math.max(0, e.touches[0].clientY - start.current.y));
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = start.current;
    start.current = null;
    setDrag(0);
    if (!s) return;
    const t = e.changedTouches[0];
    if (isCloseSwipe(t.clientX - s.x, t.clientY - s.y)) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="z-[70] bg-black/90" />
        <DialogPrimitive.Content
          aria-label={media.alt}
          aria-describedby={undefined}
          onClick={(e) => {
            // The backdrop is this full-screen box; the media itself isn't a target.
            if (e.target === e.currentTarget) onOpenChange(false);
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => {
            start.current = null;
            setDrag(0);
          }}
          style={{
            transform: drag ? `translateY(${drag}px)` : undefined,
            paddingTop: "max(1rem, env(safe-area-inset-top))",
            paddingRight: "max(1rem, env(safe-area-inset-right))",
            paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
            paddingLeft: "max(1rem, env(safe-area-inset-left))",
          }}
          className="fixed inset-0 z-[70] grid place-items-center outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {media.alt}
          </DialogPrimitive.Title>
          {media.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={media.src}
              alt={media.alt}
              width={media.width}
              height={media.height}
              decoding="async"
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          ) : (
            <video
              key={media.src}
              src={media.src}
              poster={media.poster}
              aria-label={media.alt}
              width={media.width}
              height={media.height}
              muted
              loop
              playsInline
              autoPlay={!reduced}
              controls={reduced}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          )}
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute grid size-11 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            style={{
              top: "max(0.75rem, env(safe-area-inset-top))",
              right: "max(0.75rem, env(safe-area-inset-right))",
            }}
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
