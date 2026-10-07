"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// An image in the conversation: a thumbnail that opens full size. One that
// fails to load is tried once more a few seconds later (an agent often names
// a file before writing it), then shows nothing.
export function ImageThumb({
  src,
  alt = "",
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // 0 loading or shown, 1 waiting to retry, 2 retrying, 3 gone.
  const [stage, setStage] = useState(0);
  if (stage === 3) return null;
  const shown =
    stage === 2 ? `${src}${src.includes("?") ? "&" : "?"}retry=1` : src;
  const onError = () => {
    if (stage !== 0) return setStage(3);
    setStage(1);
    setTimeout(() => setStage(2), 3000);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={alt ? `View ${alt}` : "View image"}
        className={cn("inline-block", stage === 1 && "hidden", className)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={shown}
          src={shown}
          alt={alt}
          onError={onError}
          className="m-0 max-h-40 rounded-xl object-cover"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] p-2 sm:max-w-5xl">
          <DialogTitle className="sr-only">{alt || "Image"}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-[85vh] w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
