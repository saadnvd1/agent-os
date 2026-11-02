"use client";

import { GitFork, Quote, X } from "lucide-react";

export interface ForkComposer {
  // The selection being forked; the instruction is this plus what's typed.
  quote: string;
  own: boolean;
  onOwn: () => void;
  onLeave: () => void;
  onDropQuote: () => void;
}

// Top of the composer in Fork mode: the pill that marks it, what the keys do,
// and the selection as a chip.
export function ForkHeader({ fork }: { fork: ForkComposer }) {
  return (
    <div className="mb-1.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="bg-primary/10 text-primary flex h-8 items-center gap-1.5 rounded-lg pr-1 pl-2.5 text-xs font-medium">
          <GitFork aria-hidden className="size-3.5" />
          Fork
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={fork.onLeave}
            aria-label="Cancel fork"
            className="hover:bg-primary/15 flex size-6 items-center justify-center rounded-md"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </span>
        <span className="flex-1" />
        <span className="text-muted-foreground hidden text-xs md:inline">
          ↵ start · Esc cancel
        </span>
      </div>
      {fork.quote && <QuoteChip text={fork.quote} onDrop={fork.onDropQuote} />}
    </div>
  );
}

// The selection as a chip above the box; it goes out ahead of what's typed.
export function QuoteChip({
  text,
  onDrop,
}: {
  text: string;
  onDrop: () => void;
}) {
  return (
    <div className="bg-muted/60 text-muted-foreground flex items-start gap-2 rounded-lg py-1.5 pr-1 pl-2.5 text-sm">
      <Quote aria-hidden className="mt-1 size-3.5 shrink-0" />
      <p className="line-clamp-2 min-w-0 flex-1">{text}</p>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDrop}
        aria-label="Remove quote"
        className="hover:text-foreground flex size-8 shrink-0 items-center justify-center"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
