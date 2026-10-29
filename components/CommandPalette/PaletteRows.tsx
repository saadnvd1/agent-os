"use client";

import type { LucideIcon } from "lucide-react";
import type { PaletteCommand } from "@/lib/palette/registry";
import type { Section } from "@/lib/palette/sections";
import { cn } from "@/lib/utils";

// The sections' rows under their headings, numbered in order so the caller's
// highlight and Enter agree with what's drawn.
export function PaletteRows({
  sections,
  highlighted,
  onHover,
  onRun,
}: {
  sections: Section[];
  highlighted: number;
  onHover: (i: number) => void;
  onRun: (c: PaletteCommand) => void;
}) {
  let index = 0;
  return (
    <>
      {sections.map((s) => (
        <div key={s.name || "results"} className="mb-1">
          {s.name && (
            <p className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-medium">
              {s.name}
            </p>
          )}
          {s.items.map((c) => {
            const i = index++;
            const Icon = c.icon as LucideIcon | undefined;
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === highlighted}
                data-index={i}
                onMouseMove={() => i !== highlighted && onHover(i)}
                onClick={() => onRun(c)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm md:min-h-9",
                  i === highlighted && "bg-primary/10",
                  c.id.startsWith("see-all:") && "text-muted-foreground"
                )}
              >
                {Icon && (
                  <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.title}</span>
                  {c.detail && (
                    <span
                      className={cn(
                        "block truncate text-xs",
                        c.status === "waiting"
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground"
                      )}
                    >
                      {c.detail}
                    </span>
                  )}
                </span>
                {c.hint && (
                  <kbd className="text-muted-foreground hidden shrink-0 font-mono text-[11px] sm:inline">
                    {c.hint}
                  </kbd>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
