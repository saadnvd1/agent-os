"use client";

import { useEffect, useState, type RefObject } from "react";
import { Quote } from "lucide-react";
import { useCoarsePointer } from "./composer/useCoarsePointer";

interface Picked {
  text: string;
  // Where to float it, in viewport pixels: above the selection's top.
  x: number;
  y: number;
}

// Text selected inside a reply (an element marked data-quotable).
function readSelection(root: HTMLElement): Picked | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const end =
    range.endContainer instanceof Element
      ? range.endContainer
      : range.endContainer.parentElement;
  const quotable = start?.closest("[data-quotable]");
  if (!quotable || !root.contains(quotable) || !quotable.contains(end)) {
    return null;
  }
  const text = sel.toString();
  if (!text.trim()) return null;
  const rect = range.getBoundingClientRect();
  return { text, x: rect.left + rect.width / 2, y: rect.top };
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
  if (coarse) return <div className="mb-2 flex justify-center">{button}</div>;
  return (
    <div
      className="fixed z-40 -translate-x-1/2 -translate-y-full pb-2"
      style={{ left: picked.x, top: picked.y }}
    >
      {button}
    </div>
  );
}
