"use client";

import { useEffect, useRef } from "react";
import { PALETTE_TABS, type PaletteTab } from "@/lib/palette/registry";
import { cn } from "@/lib/utils";

// The palette's tabs. Tab and Shift-Tab in the input move between them, so
// these keep out of the focus order and never take focus from it.
export function PaletteTabs({
  tab,
  onSelect,
}: {
  tab: PaletteTab;
  onSelect: (tab: PaletteTab) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label="Palette sections"
      className="border-foreground/[0.06] flex shrink-0 scrollbar-none gap-1 overflow-x-auto border-b px-2 py-1.5"
    >
      {PALETTE_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`palette-tab-${t.id}`}
          aria-selected={t.id === tab}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(t.id)}
          className={cn(
            "flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm whitespace-nowrap md:min-h-8 md:px-2.5 md:text-xs",
            t.id === tab
              ? "bg-primary/10 text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
