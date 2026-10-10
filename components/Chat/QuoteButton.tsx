"use client";

import { useEffect, useState, type RefObject } from "react";
import { Quote } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCoarsePointer } from "./composer/useCoarsePointer";
import { placeQuote, quotePick, type Placement } from "./quote-selection";

interface Picked {
  text: string;
  // Where to float it, in viewport pixels; null when scrolled out of view.
  at: Placement | null;
}

function readSelection(root: HTMLElement): Picked | null {
  const sel = window.getSelection();
  const pick = sel && quotePick(sel, root);
  if (!pick) return null;
  const rects = pick.ranges.map((r) => r.getBoundingClientRect());
  const box = {
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
    left: Math.min(...rects.map((r) => r.left)),
    right: Math.max(...rects.map((r) => r.right)),
  };
  return { text: pick.text, at: placeQuote(box, root.getBoundingClientRect()) };
}

// "Quote" for a selection in a reply. With a mouse it floats over the
// selection; on a touch screen the system's own selection menu sits there,
// so it waits above the composer instead.
export function QuoteButton({
  rootRef,
  onQuote,
}: {
  rootRef: RefObject<HTMLElement | null>;
  onQuote: (text: string) => void;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const coarse = useCoarsePointer();

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = rootRef.current;
        setPicked(root ? readSelection(root) : null);
      });
    };
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [rootRef]);

  if (!picked) return null;
  const quote = () => {
    onQuote(picked.text);
    window.getSelection()?.removeAllRanges();
    setPicked(null);
  };
  const button = (
    <button
      type="button"
      // Pressing it mustn't clear the selection before it's read.
      onMouseDown={(e) => e.preventDefault()}
      onClick={quote}
      className="bg-card popover-surface hover:bg-muted flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium md:min-h-8 md:px-3 pointer-coarse:min-h-11"
    >
      <Quote className="h-3.5 w-3.5" />
      Quote
    </button>
  );
  if (coarse)
    return <div className="mb-2 flex justify-center select-none">{button}</div>;
  if (!picked.at) return null;
  return (
    <div
      className={cn(
        "fixed z-40 -translate-x-1/2 select-none",
        picked.at.side === "above" ? "-translate-y-full pb-2" : "pt-2"
      )}
      style={{ left: picked.at.x, top: picked.at.y }}
    >
      {button}
    </div>
  );
}
